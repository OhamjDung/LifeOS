# ExpoModulesCore Legacy header shim

Vendored copies of the Legacy-API ObjC headers from `expo-modules-core@3.0.30`
(`ios/Legacy/**`, `ios/Interfaces/Permissions/*`, `ios/EXLegacyExpoViewProtocol.h`).

Why: `expo-av@15` imports `<ExpoModulesCore/EXEventEmitter.h>` and friends — Legacy
module-API protocol headers. expo-modules-core 56.x removed the `ios/Legacy/` source
tree, and the prebuilt `ExpoModulesCore.xcframework` omits these headers from its
public `Headers/` while still shipping most legacy class headers (`EXExportedModule.h`,
`EXModuleRegistry.h`, …) and their symbols.

The CI step "Create ExpoModulesCore legacy header shim" in
`.github/workflows/build-ios.yml` copies a header from here into
`mobile/ios/ExpoModulesCoreShim/ExpoModulesCore/` ONLY if the xcframework does not
already ship it. That keeps every header reachable through exactly one include
mechanism (shim via `-I`, framework via `-F`) — never both, which would reintroduce
the duplicate-definition (ODR) build failures.

These are protocol/interface declarations, stable since the unimodules era; the
implementing symbols still live in the ExpoModulesCore framework binary.

Delete this directory when expo-av is replaced with expo-audio/expo-video.
