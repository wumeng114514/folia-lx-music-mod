# 权限说明

## permissions

无。模组不声明任何运行时权限；音质和 OIAPI 密钥使用 Folia 的设置面板保存，不调用 `api.storage`。

## experimental

### omni.providers
用于在 Folia 搜索栏中注册 WY、KW、QQ 三个独立音源，提供搜索、播放、封面和歌词能力。

## 网络请求说明
本模组在主进程中使用 Node.js `https` 模块发起网络请求（主进程 modApi 不提供 `net.fetch`）。
所有请求均受以下限制：

- **仅 HTTPS** — 拒绝 `http://` 请求
- **域名白名单** — 仅允许请求代码中硬编码的固定域名列表
- **重定向限制** — 最多 3 次，且重定向时不转发原始请求头
- **响应大小限制** — 最多 5MB，超出立即断开
- **请求超时** — 10 秒

白名单域名：
- `music.163.com` — 搜索/详情/歌词
- `c.y.qq.com` / `y.qq.com` — 搜索/封面/歌词
- `search.kuwo.cn` / `img1.kuwo.cn` — 搜索/封面
- `oiapi.net` — 播放URL获取
- `p1.music.126.net` / `p2.music.126.net` — 封面CDN

不使用 `net.fetch` 权限，因为主进程 API（modApi）不暴露该接口。
