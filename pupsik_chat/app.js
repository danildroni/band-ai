import './shared/device-polyfill'
import { MessageBuilder } from './shared/message'

const messageBuilder = new MessageBuilder({
  appId: 20000,
  appDevicePort: 20,
  appSidePort: 0
})

App({
  globalData: {
    messageBuilder: messageBuilder
  },
  onCreate() {
    messageBuilder.connect()
  },
  onDestroy() {
    messageBuilder.disConnect()
  }
})
