# dsh-complete-chime

给 DeepSeek Harness Web GUI 的「任务跑完了」提示音插件：agent 跑完一轮，你人不在屏幕前，它会响铃 / 放一段音乐 / 念一句「任务完成了」/ 弹系统通知。

零依赖、零构建、零网络请求：声音是 Web Audio 现场合成的，设置存在你本机。

## 它什么时候响

- **一轮任务跑完**（当前会话的 `running` 从 `true` 变成 `false`）时响一次。
- 子代理（subagent）跑完**默认不响**，可在设置里打开。
- 默认**只在你不在窗口前时才响**（窗口最小化 / 切到别的应用 / 页面不可见）。一直想让它响就把「只在窗口不在前台时提醒」关掉。
- 同一时间多个会话一起完成，只会响一次（900ms 冷却），不会连环炸。

## 设置

设置页位置：**设置 → 完成提示音**（和别的插件设置项在同一列表里）。

| 设置项 | 说明 |
| --- | --- |
| 启用提示音 | 总开关 |
| 提示音 | 5 种合成音 + 自定义音乐：chime（三音叮咚，默认）、ding、bell、music（上行琶音）、alarm（闹钟）、custom（本地上传的音频文件） |
| 音量 | 0–100 |
| 试听 | 立刻播一遍当前选中的声音 |
| 只在窗口不在前台时提醒 | 默认开；关掉后无论你在不在看都响 |
| 语音播报 | 用系统 TTS 念一句话，文案可改（默认「任务完成了」） |
| 系统通知 | 同时弹 Windows 通知（会先请求通知权限） |
| 子代理完成也提醒 | 默认关 |
| 自定义音乐 | 上传本地音频（mp3/wav/ogg…，上限 12MB，存在浏览器 IndexedDB 里，不上传） |

所有设置改动立即生效，并写进宿主侧的 `~/.dsh/dsh-complete-chime/settings.json`；
浏览器 `localStorage` 只当首屏快速回填和宿主不可达时的兜底。

> 为什么要宿主侧存一份：DSH 桌面端每次启动都用随机端口（`--port 0`），页面 origin 跟着变，
> 只存 `localStorage` 的话重启一次设置就全丢了。

## 安装

插件目录就是当前目录，官方安装通道（在 DSH 桌面端可用的终端里）：

```powershell
dsh plugin --profile desktop add file:C:\Users\dd\Documents\deepseek-harness\default-workspace\dsh-complete-chime
```

装完**关掉 DSH 桌面端再重新打开**（profile 里的 bundle 只在启动时装载；光按 `Ctrl+R` 刷新页面不够）。
启动后打开 **设置**，列表里应该出现「完成提示音」，点「试听」能听到声音就算装好了。

手动安装（等价做法，pnpm 不可用时）：

1. 把整个 `dsh-complete-chime` 目录复制到 `C:\Users\dd\.dsh\profiles\desktop\node_modules\dsh-complete-chime`
2. 在 `C:\Users\dd\.dsh\profiles\desktop\package.json` 的 `dependencies` 里加：
   `"dsh-complete-chime": "file:C:/Users/dd/Documents/deepseek-harness/default-workspace/dsh-complete-chime"`
3. 在同一个 `package.json` 的 `dsh.profile.bundles` 数组里加一行 `"dsh-complete-chime"`
4. 重启 DSH 桌面端

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-complete-chime
```

手动装的话，删掉 `node_modules\dsh-complete-chime` 并移除上面加的两行即可。
宿主侧的 `~/.dsh/dsh-complete-chime/settings.json` 不会被自动删，想清干净就手动删目录。

## 原理 / 实现

- `lib/index.js`：宿主侧入口。桌面宿主每次启动换随机端口 → 页面 origin 变 → `localStorage` 不可靠，
  所以这里持有 `~/.dsh/dsh-complete-chime/settings.json`，并注册一个回环专用的接口：
  - `GET /api/dsh-complete-chime/settings` → `{ ok, settings }`
  - `PUT /api/dsh-complete-chime/settings` → 校验并原子写回
  - 围栏：只认回环地址 + 同源（Origin / `sec-fetch-site`）+ 64KB body 上限 + 只保留已知字段；
    设置文件坏了就回退默认值，不会把宿主的启动带崩。
- `lib/client.js`：手写 `__ModuleLoader__` bundle，不需要任何构建步骤。它做四件事：
  1. 订阅 `ctx.sessions.list`，记录每个会话的 `running`，检测 `true → false`；
  2. 用 Web Audio 的 oscillator + gain 包络合成铃声（也可播 `speechSynthesis` / `Notification`）；
  3. 启动时先 `GET` 一次宿主设置，改动时 250ms 防抖 `PUT` 回去；
  4. 在 `settings.section` 槽位注册设置页。
- 浏览器自动播放策略：插件在页面首次点击/按键时 unlock `AudioContext`，所以正常用不会有「静音不响」问题。

## 测试

```powershell
node test/run.mjs    # 客户端：47 项断言
node test/host.mjs   # 宿主侧：28 项断言（sanitize + 路由围栏 + 文件读写）
```

无头测试会在 Node 里用假的 window / AudioContext / localStorage / fetch 跑真实逻辑
（设置读写与宿主同步、防抖、失焦判定、子代理过滤、音色表、dispose 清理），不需要浏览器。

## 已做的端到端验证

在 `~/.dsh/profiles/chimetest` 这个一次性 profile 里用 CLI 真启动过一次 web 服务：
`dsh --profile chimetest --no-open --host 127.0.0.1 --port 0`。
确认了三件事：composed 配置里有本插件的 cordis 行；页面 `__DSH_BOOT__` 的 entries 里出现
`dsh-complete-chime` 且 URL 能取到真实 bundle 字节；`GET/PUT /api/dsh-complete-chime/settings`
能正常读写。验证完该测试 profile 已删除。

## 已知限制

- 只在 GUI 页面开着的时候工作；关掉整个 DSH 窗口不会响（要后台常驻提醒得靠系统级通知服务）。
- TTS 用系统语音，音色取决于 Windows 里装的中文语音包。
- 没有做「长任务预计完成时间」「重复闹钟」这类功能，需要的话再加。
