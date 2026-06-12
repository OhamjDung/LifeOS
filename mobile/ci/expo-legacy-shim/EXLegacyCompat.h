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

#endif // __OBJC__
#endif // EX_LEGACY_COMPAT_H
