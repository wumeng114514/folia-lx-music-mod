# 权限说明

逐条说明 `mod.json` 里声明的每个 permission、embedOrigins 和 experimental 为什么需要。

## permissions

| 权限 | 说明 |
|------|------|
| `net.fetch` | 需要发起网络请求：下载用户填写的 LX Music 自定义源脚本、调用各平台搜索 API 获取歌曲列表、以及脚本内部请求音频播放链接。 |
| `filesystem.data` | 需要读写模组数据存储（`api.storage.data`），用于持久化保存用户配置的脚本 URL 和音质偏好，下次启动时自动加载。 |
| `runtime.playback` | 需要与 Folia 播放系统交互，为搜索到的歌曲提供音频播放链接。 |

## embedOrigins

无。

## experimental

| API | 说明 |
|-----|------|
| `omni.providers` | 将 LX Music 注册为 Folia 的独立在线音源，使其出现在音源列表中，提供搜索和播放能力。 |
| `omni.hooks` | 预留的音频回退钩子，当其他音源播放失败时可通过 LX 脚本尝试获取替代播放链接。 |
