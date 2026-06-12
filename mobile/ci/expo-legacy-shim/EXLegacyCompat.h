// Static-inline reimplementations of legacy free functions that expo-modules-core 56
// deleted outright (declaration AND implementation — nothing left to link against).
// Force-included into every EXAV C/ObjC translation unit via:
//   OTHER_CFLAGS = ... -include "${PODS_ROOT}/../../ci/expo-legacy-shim/EXLegacyCompat.h"
// (wired by the "Wire EXAV xcconfig" step in .github/workflows/build-ios.yml).
//
// Bodies mirror expo-modules-core 3.0.30: EXErrorWithMessage built an NSError in the
// EXModulesErrorDomain; EXFatal routed to EXLogManager's fatal: which logged the error.
// static inline => internal linkage per TU, no duplicate-symbol risk.
//
// Delete together with the rest of mobile/ci/expo-legacy-shim/ when expo-av is replaced.
#ifndef EX_LEGACY_COMPAT_H
#define EX_LEGACY_COMPAT_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>

static inline NSError *EXErrorWithMessage(NSString *message)
{
  NSDictionary<NSString *, id> *errorInfo = @{NSLocalizedDescriptionKey: message};
  return [[NSError alloc] initWithDomain:@"EXModulesErrorDomain" code:0 userInfo:errorInfo];
}

static inline void EXFatal(NSError *error)
{
  NSLog(@"[expo-av EXLegacyCompat] Fatal error: %@", error);
}

// Unimodules-era promise block types (UMCore prefix) used in expo-av 15 .m files.
// EXPromiseResolveBlock/EXPromiseRejectBlock from EXDefines.h are available but
// EXAV.m uses the UM* names without importing EXUnimodulesCompat.h.
typedef void (^UMPromiseResolveBlock)(id result);
typedef void (^UMPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);

// Logging macros deleted from expo-modules-core 56.
#define EXLogInfo(format, ...)  NSLog((@"[EXAV INFO] "  format), ##__VA_ARGS__)
#define EXLogWarn(format, ...)  NSLog((@"[EXAV WARN] "  format), ##__VA_ARGS__)
#define EXLogError(format, ...) NSLog((@"[EXAV ERROR] " format), ##__VA_ARGS__)

#endif // __OBJC__
#endif // EX_LEGACY_COMPAT_H
