# Folia LX Music 音源 Mod

[Folia](https://folia.app) 的 [Folium](https://folia.app/folium) 模组，让你通过 [洛雪音乐 (LX Music)](https://github.com/lyswhut/lx-music-desktop) 自定义源脚本在 Folia 中搜索和播放音乐。

## ✨ 功能

- 🎵 **独立音源** — 在 Folia 音源列表中显示为 "LX Music"，支持在线模式
- 🔍 **搜索** — 直接搜索歌曲（聚合网易云等平台搜索结果）
- ▶️ **播放** — 通过 LX Music 自定义源脚本获取音频链接
- ⚙️ **简单配置** — 只需粘贴自定义源脚本 URL 即可使用

## 📦 安装

### 方法一：下载安装
1. 下载 [Releases](../../releases) 中的 `.zip` 文件
2. 在 Folia 中：**设置 → 模组 → 从文件安装**，选择 zip 文件
3. 启用模组

### 方法二：手动安装
1. 将 `mod.json`、`main.cjs`、`client.mjs` 复制到：
   ```
   %AppData%\Folia\mods\lx-music-source\
   ```
2. 重启 Folia，在模组页面启用

## 🔧 使用

1. 启用模组后，进入模组设置
2. 在「**脚本 URL**」中填入 LX Music 自定义源脚本地址，例如：
   ```
   https://raw.githubusercontent.com/pdone/lx-music-source/main/juhe/latest.js
   ```
3. 保存设置并重启 Folia
4. 在音源列表中选择 **LX Music** 即可搜索和播放

## 📋 支持的 LX 源

任何符合 [LX Music 自定义源规范](https://lxmusic.toside.cn/desktop/custom-source) 的脚本均可使用。脚本需提供 `musicUrl` action。

## 🛠️ 技术说明

- **Folium v1.4** 兼容
- 使用 `omni.providers` 实验性 API 注册为 Folia 音源
- 在全局环境中直接执行 LX 源脚本（兼容性最佳）
- 模拟完整的 `globalThis.lx` API（`request`、`utils.crypto`、`utils.zlib` 等）

## ⚠️ 免责声明

1. 本项目仅供**个人学习和研究**使用，**严禁用于商业用途**。
2. 本项目**不提供任何音频资源**，所有音频内容均来自第三方自定义源脚本，与本项目无关。
3. 使用本项目所产生的一切法律纠纷及责任，由使用者自行承担，与本项目开发者无关。
4. 如果本项目侵犯了您的权益，请联系作者删除。
5. 请在下载后 **24 小时内删除**，支持正版音乐。
6. 本项目不对第三方自定义源脚本的安全性、合法性、可用性做任何保证。

**使用本项目即代表你已阅读并同意以上声明。**

## 📄 许可

MIT
