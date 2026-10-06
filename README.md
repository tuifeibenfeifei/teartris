# TearTris · 撕纸俄罗斯方块

一个为 **DeepSeek Harness（DSH）** 做的摸鱼小游戏插件，也是独立的 HTML5 游戏。

> **核心玩法：双层图 + 消行撕纸。** 棋盘背景是两张叠在一起的图片——上层图 A 盖着下层图 B。
> 每消除一行，就把那一行的上层图「撕开」，露出下层图，两张图拼在一起，越玩越像一张新画。

![screenshot](screenshot.png)

## 效果演示

- 开局：整块棋盘显示**上层图 A**（默认示例：白天花园），方块半透明，背景透出。
- 消行：被消除的那一行，上层图该位置**永久消失**，露出**下层图 B**（默认示例：星空极光）的对应位置，带锯齿撕边和撕纸动画。
- 终局：20 行全部撕开后，整张棋盘完全变成下层图 B 的画面。
- 可以换成任意两张你自己的图片（见下文「自定义图片」）。

> 撕纸的语义是**纸固定、内容下落**：撕口留在下层图原来的位置不动，上面的方块连同图案一起往下掉。
> 所以 `grid`（方块）与 `torn`（撕口）必须同步压缩，否则撕口会和它对应的图案错位 —— 看起来就像没消干净。

## 安装（DSH 插件）

```bash
# 从 GitHub 安装（建议 pin 一个 release tag）
dsh plugin --profile <你的 profile> add github:tuifeibenfeifei/teartris#v1.1.0

# 硬刷新浏览器（Ctrl/Cmd+Shift+R）后，右下角出现「T」悬浮按钮
# 点击按钮打开游戏面板，也可以直接访问 http://<dsh-host>:<port>/teartris/
```

> - 首次安装若被 pnpm 拦截构建脚本，先在 profile 目录执行 `pnpm approve-builds --all` 再重试。
> - **桌面版（Electron）的 `desktop` profile 由应用独占**，`dsh plugin --profile desktop` 会拒绝执行；
>   请在应用的插件管理界面里安装，或把本包 link 进 profile 的 `node_modules` 并加进 `dsh.profile.bundles`。
> - 面板默认漂浮在右下角，可以拖标题栏移动，双击标题栏回到默认位置；开关状态记在 `localStorage`。
> - 面板打开时，主界面的 `← → ↓ ↑ 空格 Z X C P R M` 会转发给游戏，所以在聊天框里也能直接玩。

## 直接玩（无需 DSH）

把本仓库克隆下来（或只下载 `index.html` 和 `assets/`），**双击 `index.html`** 即可在浏览器里游玩，无需任何依赖。

> 想看 AI 自动演示撕纸效果？打开 `index.html?demo` —— 内置贪心 AI 会主动消行，逐层撕开上层图。

## 自定义图片

游戏支持把任意两张图片作为上/下层背景：

- **按钮**：右侧面板「选择 上层图 A」/「选择 下层图 B」。
- **拖拽**：直接把图片拖到棋盘上，左半边放上层 A，右半边放下层 B；一次拖入两张则自动分配。
- 自定义图片会**先等比缩到 1280px 内再存进 IndexedDB**，不吃内存也不会拖慢加载；下次打开仍在；点「重置为示例图」恢复默认。
- 图片按 cover 模式等比裁切铺满棋盘，任何比例都能用。

## 操作

| 按键 | 功能 |
| --- | --- |
| `←` / `→` | 左右移动 |
| `↑` / `X` | 顺时针旋转（SRS 踢墙） |
| `Z` | 逆时针旋转 |
| `↓` | 软降（+1 分/格） |
| `空格` | 硬降（+2 分/格） |
| `C` | 暂存（Hold） |
| `P` / `Esc` | 暂停 |
| `R` | 重新开始 |
| `M` | 音效开关 |

计分：1/2/3/4 行 = 100/300/500/800 × 等级；连击有加成（每层 +50 × 等级）；四行全清额外 +400 × 等级。
等级每 10 行 +1，下落间隔 900ms 起、每级 -75ms，最低 90ms。

移动端有触屏按钮，**按住 220ms 后自动连发**（硬降不连发）；切走标签页会自动暂停，回来不会因为积攒的时间一口气掉到底。

## 目录结构

```
teartris/
├── index.html            # 游戏本体（单文件，内联 CSS/JS，可独立游玩）
│                         #   上半部＝纯逻辑（消行/撕纸/SRS/计分），下半部＝渲染+输入+音频
├── assets/
│   ├── imageA.webp       # 上层示例图（白天花园），WebP 优先加载
│   ├── imageB.webp       # 下层示例图（星空极光）
│   ├── imageA.jpg        # 同上，老浏览器不认 WebP 时的兜底
│   └── imageB.jpg
├── lib/
│   ├── index.js          # DSH 插件 Node 半部：一条 /teartris 前缀路由提供页面与图片
│   └── client.js         # DSH 插件客户端半部：右下角悬浮按钮 + 可拖拽游戏面板（纯 DOM）
├── tests/
│   ├── run.js            # 纯逻辑测试 + 模拟 DOM 冒烟测试（33 项）
│   ├── client.js         # 客户端插件测试：宿主契约 / 挂载 / 按键转发 / 清理（14 项）
│   ├── routes.js         # Node 半部路由黑盒测试：可达性 / 穿越防护 / 缓存语义（35 项）
│   ├── shot.mjs          # 用真实渲染路径录一帧 Canvas 指令
│   └── dom-stub.mjs      # 极简 DOM/Canvas 桩，让游戏逻辑与客户端插件都能在 Node 里跑
├── tools/
│   └── replay.py         # 把录下来的 Canvas 指令重放成 PNG（截图就是这么来的）
├── package.json          # DSH 插件包清单（cordis 插件格式）
├── dsh.plugin.json       # DSH 插件声明
├── cordis.patch.yml      # DSH profile layer 注入补丁
├── icon.svg              # 插件图标（插件管理页显示）
├── locale/{zh,en}.json   # 插件管理页的标题与描述
├── screenshot.png        # 效果截图
├── README.md
└── LICENSE               # MIT
```

## 开发与测试

```bash
npm test                 # 三套测试一起跑（82 项断言）
node tests/run.js        # 游戏逻辑 + 模拟 DOM 冒烟
node tests/client.js     # 客户端插件：宿主契约 / 挂载 / 按键转发 / 清理
node tests/routes.js     # 插件路由：可达性 / 穿越防护 / 缓存语义
node tests/shot.mjs && python tools/replay.py tests/last-frame.json out.png   # 重新出截图
```

测试都是零依赖的：`tests/run.js` 把 `index.html` 里的 `<script>` 抠出来，
裁掉只服务浏览器的 `boot()` 段丢进 `node:vm` 里跑，所以**游戏本体可以继续是单文件**，
核心规则却仍然有回归测试覆盖（撕纸行错位、软降计分这类 Bug 都有专门的用例钉住）。
`tests/client.js` 用同一套桩验证客户端插件的宿主契约 —— 尤其是
**`dsh.client.immediately` 必须为 `true`**，否则宿主只会登记 bundle 而永不执行它，
右下角按钮根本不出现。

`tests/shot.mjs` + `tools/replay.py` 是同一套思路的延伸：在 Node 里把游戏真跑起来，
录下一帧完整的 Canvas 指令，再由 Python 重放成 PNG。所以截图和游戏代码永远一致。

## 技术要点

- **双层背景渲染**：下层图整幅铺底；上层图按 20 个行带逐条绘制，已撕开的行带跳过。
- **上层图离屏缓存**：未撕开的上层图只在「撕口变化 / 换图 / DPR 变化」时重建到一张离屏画布，
  每帧只贴一次图 —— 省掉每帧约 20 次 `drawImage` 和最多 20 次锯齿裁剪。
- **撕纸效果**：每条撕边预生成确定性锯齿（按边界哈希的伪随机），消除瞬间有「揭起 + 纸屑 + 亮光」动画。
- **标准俄罗斯方块**：7-Bag 随机、SRS 踢墙、幽灵块、Hold、Next×3、连击计分、等级加速、整张全清奖励。
- **零依赖**：无 npm 运行时依赖；页面在 `file://` 与 DSH 路由两种环境下均可运行。
- **插件路由**：一条 `prefix` 路由覆盖页面与全部静态资源，带路径穿越防护、ETag 协商缓存与
  `GET/HEAD/405` 语义；新增图片不需要改路由代码。

## 兼容性

- DSH：`>= 0.0.1`。插件需要宿主提供 `webServer` 服务与 `dsh.client` 客户端插件机制。
- 浏览器：Chrome / Edge / Firefox / Safari 现代版本（Canvas 2D、IndexedDB、Web Audio、可选 WebP）。

## License

MIT © 2026
