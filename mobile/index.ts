const { Alert } = require('react-native')

global.ErrorUtils?.setGlobalHandler?.((error: any, isFatal?: boolean) => {
  if (isFatal) {
    Alert.alert(
      'Fatal JS Error',
      (error?.message ?? 'no message') + '\n\n' + (error?.stack?.slice(0, 500) ?? 'no stack')
    )
  }
})

require('expo-router/entry')
