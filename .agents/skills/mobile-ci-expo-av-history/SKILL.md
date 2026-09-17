---
name: mobile-ci-expo-av-history
description: Historical root-cause notes for the expo-av vs Expo SDK 56 CI build breakage (runs 39-83, resolved in commit 4e4da5a by migrating to expo-audio). Load this only if a similar Xcode/CocoaPods module-build error resurfaces in the iOS CI pipeline (build-ios.yml) - e.g. missing headers, module-build vs CompileC path errors, or Swift/ObjC protocol symbol issues in a vendored pod.
---

## CI Build Breakage: expo-av vs SDK 56 (runs 39–83, June 2026) — RESOLVED run 83

**Root cause — why build 38 worked and 39+ didn't**: run 38 (commit `e9b28b0`) was the
last build WITHOUT expo-av. Run 39's commit `1df9bc5` added `expo-av ~15.0.0` to fix the
voice "Session activation failed" bug. expo-av 15 is an SDK 52-era, deprecated pod (last
supported SDK ~54, uses the removed Legacy module API) inside an SDK 56 app — every CI
failure since run 39 is that one dependency. Nothing else regressed.

**Terminal fix (recommended)**: migrate `braindump.tsx`/`notes.tsx` from expo-av
`Audio.Recording` to `expo-audio` (SDK 56-native), drop `expo-av` from package.json, and
delete `mobile/ci/expo-legacy-shim/` + the two EXAV CI steps. The shims below only make
expo-av COMPILE; runtime behavior on device is unverified.

**Shim inventory (what's working)** — each fixed a confirmed failure:

| Piece | Fixes | Run that proved it |
|---|---|---|
| `mobile/ci/expo-legacy-shim/ExpoModulesCore/*.h` (31 vendored Legacy headers from expo-modules-core 3.0.30) + "Create ExpoModulesCore legacy header shim" step (copy-if-absent vs xcframework Headers) | `'ExpoModulesCore/EXEventEmitter.h' file not found` — expo-modules-core 56.x deleted `ios/Legacy/` from npm AND omits those headers from the prebuilt xcframework | 58 |
| "Wire EXAV xcconfig" step → `HEADER_SEARCH_PATHS += shim dir + Pods/React-Core-prebuilt/React.xcframework/Headers`, `OTHER_CFLAGS/OTHER_CPLUSPLUSFLAGS/OTHER_SWIFT_FLAGS += -ivfsoverlay React-VFS.yaml` | `'React/RCTBridgeModule.h' file not found` — RN 0.85 ships React-Core prebuilt; flat `<React/X.h>` names exist ONLY through the clang VFS overlay, and RN wires it only into pods depending on `React-Core` (expo-av depends on `ReactCommon/turbomodule/core`) | 65 |
| "Patch expo-av Swift" step (rewrites `VideoViewModule.swift` resolver closure) | `Promise.ResolveClosure` retyped to `(JavaScriptValue) -> Void` in ExpoModulesCore 56 | 66 |
| `EXLegacyCompat.h` force-included via `-include` in EXAV OTHER_CFLAGS | `EXFatal`/`EXErrorWithMessage` undeclared — deleted from expo-modules-core 56 (symbol gone too, so static-inline reimplementation, not a declaration) | 67 |
| "Remove expo-av video Swift files" step deletes `VideoViewModule.swift` + `ExpoVideoView.swift`, patches `EXAV.m` (remove `EXAV-Swift.h` import, replace `ExpoVideoView`→`EXVideoView`), patches `EXAV.h` (`EXEventEmitter` import → `@protocol EXEventEmitter;` forward decl), patches `expo-module.config.json` (remove `VideoViewModule` from `apple.modules`) | EXAV Swift files trigger `-import-underlying-module` → ObjC module build → framework EXEventEmitter.h lookup fails; ExpoVideoView deleted Swift class referenced at runtime; EXAV-Swift.h never generated when no Swift files; expo-configure-project.sh (Xcode build phase) REGENERATES ExpoModulesProvider.swift at build time from expo-module.config.json, overwriting any post-install patch | 73–80 |
| "Remove VideoViewModule from generated Expo scripts" step patches `expo-configure-project.sh` (sed removes VideoViewModule lines) + `ExpoModulesProvider.swift` (Python re.sub belt-and-suspenders) | Belt-and-suspenders for case where module list baked into shell script vs re-read from JSON | 80 |
| `EXLegacyProtocolStubs.m` (base64-decoded into expo-av source tree, compiled into libEXAV.a) — defines `EXEventEmitter` + `EXLegacyExpoViewProtocol` protocols with `__attribute__((constructor))` function referencing them | `Undefined symbols for architecture arm64: __OBJC_PROTOCOL_$_EXEventEmitter` + `__OBJC_PROTOCOL_$_EXLegacyExpoViewProtocol` — deleted from expo-modules-core 56 xcframework binary; EXAV.o and EXVideoView.o reference them at link time | 83 ✅ |

**Post-mortem: what worked, what failed, and why**

The core problem was two orthogonal compilation paths with different header lookup rules:

| Path | Triggered by | Header lookup | Shim works? |
|---|---|---|---|
| **CompileC** | Direct `.m` compilation | `-I` (flat dirs) | ✅ yes |
| **Module build** | Swift files in pod → `-import-underlying-module` | `-F` (framework lookup into XCFrameworkIntermediates) | ❌ no — xcframework slice omits legacy headers |

Every single error in this saga was one of these paths hitting a missing symbol or header. The shim we built fixes CompileC but can never fix module builds — those use a completely separate framework copy that Xcode assembles from the xcframework slice at build time, and injecting files there has no effect.

**What worked and why:**

- **Vendored 31 legacy headers + `-I` shim** (run 58): Gave CompileC path access to headers expo-modules-core 56 deleted. Correct — this is the only safe place to inject them.

- **VFS overlay for `<React/X.h>`** (run 65): RN 0.85 ships React-Core as a prebuilt xcframework and wires the VFS flat-root only into pods that directly depend on `React-Core`. expo-av depends on `ReactCommon/turbomodule/core`, not `React-Core`, so it never got the overlay. Adding `-ivfsoverlay React-VFS.yaml` to EXAV's xcconfig fixed it. Correct — understand the dependency graph before assuming "all pods get the same flags."

- **`EXLegacyCompat.h` force-include via `-include`** (runs 67+): `EXFatal` and `EXErrorWithMessage` were deleted as both declaration AND symbol from expo-modules-core 56. A header forward-declaration would compile but fail at link. Static-inline reimplementation in a force-included header bypasses both problems — no symbol reference, no link dependency.

- **Deleting Swift files (`VideoViewModule.swift`, `ExpoVideoView.swift`)** (run 73+): Swift files in a CocoaPods static pod trigger `-import-underlying-module` at compile time. That forces a module build of the pod's umbrella header. Module builds use `-F XCFrameworkIntermediates` — the xcframework slice copy — which never has the legacy headers we injected. Removing the Swift files eliminates the module build path entirely. This was the right lever; all the header injection into the xcframework was wrong.

- **Forward declarations in `EXAV.h` and other expo-av headers** (runs 76–77): After deleting the Swift files, ExpoModulesProvider.swift still `import`s the EXAV Clang module (module map exists from pod install). That triggers a module compilation. Forward decls (`@protocol EXEventEmitter;`) let module compilation succeed — full definitions are only needed in the `.m` CompileC path, where the shim provides them.

- **Patching `expo-module.config.json` + `expo-configure-project.sh`** (run 80): The [Expo] Configure project Xcode build phase regenerates `ExpoModulesProvider.swift` from `expo-module.config.json` at BUILD TIME, after our post-install patch. Patching the JSON source prevents both the pod-install generation and the build-time regeneration from knowing about VideoViewModule. Patching the generated shell script is belt-and-suspenders for the "baked-in list" case.

- **`EXLegacyProtocolStubs.m` with `__attribute__((constructor))`** (run 83): Compilation succeeded but the linker couldn't find `__OBJC_PROTOCOL_$_EXEventEmitter` or `__OBJC_PROTOCOL_$_EXLegacyExpoViewProtocol` — deleted from expo-modules-core 56 binary. ObjC protocol metaclass objects only exist in the binary if a compiled `.m` file DEFINES the protocol AND references it with `@protocol(X)`. Injecting a stub `.m` into expo-av's source tree before pod install causes CocoaPods to compile it into `libEXAV.a`, providing the linker symbols. The `__attribute__((constructor))` function scope allows `@protocol()` runtime expressions (not valid as static initializers) and prevents dead-strip.

**What failed and why:**

- **Copying headers into `Pods/Headers/Public/ExpoModulesCore/`** (`a1d422c`): Created a second path to the same headers — once via `-I Pods/Headers/Public/ExpoModulesCore` AND once via `-F XCFrameworkIntermediates/ExpoModulesCore.framework/Headers`. ObjC ODR: two definitions of the same `typedef` → redefinition errors. Rule: only one path per header, ever.

- **`target.build_settings` in Podfile `post_install`** (run 64): Expo's and RN's own `post_install` hooks run AFTER ours and merge our scalar string value into a Ruby array. When Xcode serializes that, it becomes one giant `-I["path1", "path2"]` argument — syntactically invalid. Must edit xcconfig files directly after pod install.

- **Injecting headers into the xcframework** (runs 71–72): Xcode's "Copy XCFrameworks" build phase copies the xcframework slice into `XCFrameworkIntermediates/`. It ONLY copies files that were originally in the slice — injected files are silently ignored. The xcframework is read-only from Xcode's perspective.

- **`DEFINES_MODULE = NO` in xcconfig** (`d27cf16`): CocoaPods generates the EXAV module map during `pod install`, before our xcconfig patch runs. Xcode's module build uses the pre-existing module map; `DEFINES_MODULE=NO` in the xcconfig has no effect on an already-generated module map.

- **Patching `ExpoModulesProvider.swift` after pod install** (runs 78–79): The [Expo] Configure project build phase (wired in the LifeOS Xcode project) runs `expo-configure-project.sh` at build time, regenerating the file. Our patch was correct but got overwritten before compilation.

- **`ExpoUseSources = true`** (`4e00d63`): Attempted to build expo-modules-core from source instead of xcframework. Failed — the Swift compiler version mismatch (xcframework compiled with Swift 6.3.1, runner has Swift 6.2.3) manifests differently in source mode. Also significantly increases build time.

- **Static `void *` initializer for `@protocol()`** (run 82): `@protocol(EXEventEmitter)` is an ObjC runtime expression, not a compile-time constant. Valid inside a function body; invalid as a file-scope static initializer. Clang correctly rejects it with "initializer element is not a compile-time constant."

**The meta-lesson**: this entire saga was ~45 CI runs because each fix only addressed the topmost error layer. The real fix was always "understand WHICH compilation path is hitting WHICH missing piece, and fix the right path." The two-path model (CompileC vs module build) explains every single failure.

**Hard-won rules (violating these re-breaks the build)**:
- NEVER copy xcframework headers into `Pods/Headers/Public/ExpoModulesCore/` — same header
  reachable via both `-I` and `-F` → ODR redefinition errors (run 3-of-saga / `a1d422c`).
- NEVER set EXAV search paths/flags via `target.build_settings` in Podfile `post_install` —
  Expo/RN hooks that run later merge the value into a Ruby array that gets STRINGIFIED into
  the build command as one giant `-I["…", "…"]` arg (run 64). Edit
  `Pods/Target Support Files/EXAV/EXAV.{release,debug}.xcconfig` after `pod install` instead.
- Don't add the shim `-I` to other Expo pods — broke ExpoTaskManager's module build (run 58).
- Local `mobile/node_modules` is STALE (npm install on CI resolves fresh; expo-modules-core
  is SDK-versioned now: CI gets 56.x, local had 3.0.30). Verify versions against the npm
  registry, never against local files.

**Debugging method that works** (each failed run = ~10 min, so maximize data per run):
1. Workflow uploads raw `/tmp/xcodebuild.log` as artifact `xcodebuild-log` on failure —
   step logs alone are useless (xcpretty swallows errors; run 59 failed with zero visible
   error lines). The build step must use `if ! pipeline` — under `bash -e` + `pipefail`, a
   plain pipeline aborts the step before any error extraction runs.
2. In the raw log, find the failing task (`SwiftDriver EXAV`, `CompileC …`), read clang's
   `note:` lines (run 61's "did not find header … in framework 'React' (loaded from …)"
   identified the VFS problem), and diff the full command's `-I`/`-F`/`-Xcc` args against a
   pod that compiles the same import successfully.
3. Dump ground truth in the diagnose step when theory runs out: resolved `React-VFS.yaml`,
   pod xcconfigs, `Pods/Headers/Public/` contents (runs 60/63 each turned a guess into a fact).
4. Known future fork: ExpoModulesCore 56.0.16 xcframework swiftinterface = Swift 6.3.1;
   Xcode 26.2 on `macos-15` = Swift 6.2.3. If "module compiled with newer Swift" appears,
   select a newer Xcode on the runner — do NOT retry `$ExpoUseSources` (failed, `4e00d63`).

**Checking CI logs automatically** (no `gh` CLI — use curl + Git Credential Manager):

```bash
# Get OAuth token git already has stored
TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill | grep password | cut -d= -f2)

# 1. Find latest run ID (public — no auth needed)
RUN=$(curl -s "https://api.github.com/repos/OhamjDung/LifeOS/actions/workflows/build-ios.yml/runs?per_page=1" \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['id'], r['status'], r['conclusion'])")
echo "Run: $RUN"
RUN_ID=$(echo $RUN | cut -d' ' -f1)

# 2. Poll run status (repeat until conclusion != null)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/runs/$RUN_ID" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['status'], r['conclusion'])"

# 3. Get per-step results + job ID
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/runs/$RUN_ID/jobs" \
  | python3 -c "
import sys,json
jobs=json.load(sys.stdin)['jobs']
for j in jobs:
    print(f'Job {j[\"id\"]}: {j[\"conclusion\"]}')
    for s in j['steps']: print(f'  [{s[\"conclusion\"]}] {s[\"name\"]}')
"

# 4. Download full step logs (auth required)
JOB_ID=<job_id_from_step_3>
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/jobs/$JOB_ID/logs" \
  -o /tmp/ci_job.log
grep -E "error:|warning:|FAILED|❌" /tmp/ci_job.log | head -40
```

**Caveat**: job logs = step stdout only. Raw `xcodebuild.log` (full compiler output) lives in `/tmp/xcodebuild.log` on the runner. The workflow uploads it as an artifact on failure — download via:
```bash
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/runs/$RUN_ID/artifacts" \
  | python3 -c "import sys,json; [print(a['name'], a['archive_download_url']) for a in json.load(sys.stdin)['artifacts']]"
# Then curl -sL -H "Authorization: Bearer $TOKEN" <archive_download_url> -o /tmp/artifact.zip
```

