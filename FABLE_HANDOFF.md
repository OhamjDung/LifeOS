# CI Build Handoff for Fable

## Context

Repo: `LifeOS` (React Native / Expo SDK 56 + Xcode 26.2 on `macos-15`).
Pipeline: `.github/workflows/build-ios.yml` — `expo prebuild` → `pod install` → `xcodebuild archive` (unsigned).
Goal: produce a `.ipa` artifact installable via AltStore.

---

## Where we are

**Run 1** — script bug: shell step tried `cp "$XCF_HDR"/EXEventEmitter.h ...`; `EXEventEmitter.h` doesn't exist in ExpoModulesCore 56 (removed v49+, now Swift-native). `exit 1` hit. xcodebuild never ran.

**Run 2** — fixed the shell glob (`find -exec cp`); 78 headers copied. xcodebuild ran but failed.

**Run 3** — xcodebuild reached actual compilation but died with ODR violations:
```
EXDefines.h:83: redefinition of 'EXMethodInfo'
EXDefines.h:88: redefinition of 'EXModuleInfo'
EXExportedModule.h: duplicate interface definition for class 'EXExportedModule'
EXModuleRegistry.h: duplicate interface definition for class 'EXModuleRegistry'
EXPermissionsInterface.h: redefinition of 'EXPermissionStatus'
EXTaskLaunchReason.h: redefinition of enumerators
EXFileSystemInterface.h: redefinition of 'EXFileSystemPermissionFlags'
```

---

## Root cause (confirmed)

**ExpoModulesCore 56 ships as a prebuilt xcframework** at `Pods/ExpoModulesCore/ExpoModulesCore.xcframework/`. CocoaPods does NOT create `Pods/Headers/Public/ExpoModulesCore/` for prebuilt xcframeworks.

Previous fix attempts manually copied the xcframework's device-slice headers to `Pods/Headers/Public/ExpoModulesCore/`. This made them accessible via `-I` (HEADER_SEARCH_PATHS).

But xcodebuild also exposes the SAME headers via `-F` (FRAMEWORK_SEARCH_PATHS → XCFrameworkIntermediates). Result: two different physical paths to the same content. Clang tracks `-I` inclusions and `-F` framework inclusions separately. `#pragma once` only deduplicates within one mechanism. Headers included via BOTH `-I` and `-F` → compiled twice → ODR.

**The double-inclusion path**:
1. EXAV (and other Expo pods) do `#import <ExpoModulesCore/EXDefines.h>`
   → resolved via `-I Pods/Headers/Public/ExpoModulesCore/EXDefines.h` (our manual copy)
2. The xcframework umbrella does `#import "Headers/ExpoModulesCore_umbrella.h"`
   → resolved via `-F XCFrameworkIntermediates/ExpoModulesCore/ios-arm64/ExpoModulesCore.framework/`
   → umbrella `#import "EXDefines.h"` → different physical file
3. Same struct definitions compiled twice → redefinition errors

---

## Fix applied (in this branch)

Two changes to `.github/workflows/build-ios.yml`:

### 1. Removed the header copy step

`Fix ExpoModulesCore headers for prebuilt xcframework` → renamed `Diagnose ExpoModulesCore xcframework headers`, diagnostic-only (no `cp`, no `mkdir Pods/Headers/Public/ExpoModulesCore`).

### 2. Added FRAMEWORK_SEARCH_PATHS in Podfile post_install

The `Patch Podfile for CI` step now injects a second block into `post_install do |installer|`:

```ruby
xcf_arm64 = '$(PODS_ROOT)/ExpoModulesCore/ExpoModulesCore.xcframework/ios-arm64'
expo_consumers = %w[EXAV ExpoLocation ExpoFileSystem ExpoTaskManager ...]
installer.pods_project.targets
  .select { |t| expo_consumers.include?(t.name) }
  .each do |target|
    target.build_configurations.each do |config|
      fsp = config.build_settings['FRAMEWORK_SEARCH_PATHS']
      # ... append xcf_arm64 to fsp
    end
  end
```

**Why this is safe**: With no manual copy, there is NO `-I` path for ExpoModulesCore. All imports resolve via `-F` only. Clang deduplicates framework imports by `(framework_name, header_name)` key, so even if xcodebuild also adds an XCFrameworkIntermediates `-F` path, both paths point to the same framework and clang treats the import as already satisfied.

---

## What to expect next run

**Happy path (Fork A)**: Both changes together fix it. Build proceeds, IPA produced.

**Unhappy path (Fork B)**: New error — either "header not found" for some ExpoModulesCore header, or a Swift ABI error from the prebuilt xcframework.

### If "header not found" comes back

Do NOT re-add the manual copy. Instead:

1. Check the diagnostic step output: did arm64 headers list correctly? Did `Pods/Headers/Public/ExpoModulesCore/` stay absent?
2. Check whether `$(PODS_ROOT)/ExpoModulesCore/ExpoModulesCore.xcframework/ios-arm64/ExpoModulesCore.framework/Headers/` actually contains the missing header. If the header genuinely does not exist in the xcframework (like `EXEventEmitter.h` which was removed in v49+), the pod importing it is incompatible with SDK 56.
3. If missing header is a legacy `EXEventEmitter.h` import from EXAV or another pod: that pod is not updated for SDK 56. Options:
   - Force source build for ExpoModulesCore (not that pod): `$ExpoUseSources = true` before `use_expo_modules!` in Podfile (force CocoaPods to build from Swift source → creates Pods/Headers/Public normally). NOTE: was tried in commit `4e00d63` and failed — check the CI log from that run before retrying.
   - Alternatively: provide a thin shim header at `mobile/ios/EXEventEmitter.h` that stubs out the interface.

### If Swift ABI error from prebuilt xcframework

The prebuilt xcframework was compiled with a specific Swift compiler version. Xcode 26.2 ships Swift 6.2.3. If the ABI doesn't match:
- Set `$ExpoUseSources = true` (or `$ExpoUseSources = ['ExpoModulesCore']`) in Podfile to force source build — this recompiles ExpoModulesCore with the runner's Swift version.
- Check the `.swiftinterface` file: `Pods/ExpoModulesCore/ExpoModulesCore.xcframework/ios-arm64/ExpoModulesCore.framework/Modules/ExpoModulesCore.swiftmodule/arm64-apple-ios.swiftinterface` — the first line has the compiler version. If it says Swift < 6.2, ABI mismatch is the issue.

---

## History (don't repeat these)

| Commit | What it tried | Why it failed |
|--------|--------------|---------------|
| `6df3fec` | `EXPO_USE_PRECOMPILED_MODULES=0` env | xcframework still installed (env var not recognized) |
| `4e00d63` | `$ExpoUseSources = true` globally | Unknown — check that run's log |
| `83b80b6` | `$ExpoUseSources = ['expo-av']` + EXPO_USE_SOURCE=1 | Reverted — expo-av source build broke something |
| `4c47d0b` | Reverted expo-av to xcframework, kept ExpoModulesCore header fix | Header fix alone not enough |
| `3cd70cd–e5019c0` | Patch EXAV xcconfig HEADER_SEARCH_PATHS / FRAMEWORK_SEARCH_PATHS | Various path issues, fragile |
| `a1d422c` | Copy xcframework headers to Pods/Headers/Public | This run — double-inclusion ODR errors |

**Do not**: add headers back to `Pods/Headers/Public/ExpoModulesCore/`. That is the confirmed cause of the ODR failures.

---

## Files changed

- `.github/workflows/build-ios.yml` (only file modified)

## Decision point

Push this branch → trigger CI → look at xcodebuild step. If it passes, done. If new error, classify by the guide above.
