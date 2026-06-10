try {
  require('expo-router/entry')
} catch (e: any) {
  console.error('[LIFEOS_FATAL] message=' + (e?.message ?? 'none'))
  console.error('[LIFEOS_FATAL] stack=' + (e?.stack ?? 'none'))
}
