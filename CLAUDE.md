# raymarchcity — 工作规则

## 硬约束
- 产物只有 `index.html`（内联 GLSL）。`verify.mjs` / `PLAN.md` / `RETRO.md` / `HANDOFF.md` 是开发文件。
- 除 three.js importmap CDN（锁定版本号）外零外部依赖；最终产物 `file://` 双击可开。
- 场景在一个 fragment shader 里，M6 起允许第二个全屏后期 pass（bloom 降采样）；两个 shader 都内联在 index.html。three.js 只做全屏 quad + uniforms，相机在 shader 里算，不用 OrbitControls。
- fps 上限 60；页面失焦暂停渲染。
- 音频初始化全部在用户手势事件里（AudioContext autoplay 限制）。
- shader 中任何 NaN 输出纯品红 `#FF00FF`。
- Retina DPR=2：renderScale 基于 CSS 像素，默认 0.75，绝不再乘 DPR。
- 开发用本地 http 服务（file:// 下 Chrome 可能拒麦克风）。

## 验证（每次改 shader 必跑）
- `npm run verify` = `node verify.mjs`：有头 chromium，deviceScaleFactor 2，窗口 1720x720，打开 `index.html?test=1`。
- `?test=1`：iTime 固定 8.0，camz 默认 44（峡谷段），音频 uniforms 用 sin(t) 合成，整数哈希保证跨加载一致，不请求麦克风。可加 &beat= &search= &flash= &camz= &noaa=1 &rec=N。
- 等 3 秒读 `window.__stats`（fps/frameMs/shaderError/renderScale/rt 尺寸/DPR/GPU），截图 `shots/latest.png` + `shots/M<n>-<hhmm>.png`。
- 通过：shaderError 空；fps ≥ 50；非黑像素 > 40%；品红 < 0.1%；最暗 5% 像素亮度均值 < 0.03（必须有真正的黑）；最亮 0.5% 像素亮度均值 > 0.9（M8 起，光少而准）；暖色像素 ≤12%；flicker（0.02 位移两帧差）≤1.2%；亮度重心偏离中心 ≥3%；亮斑连通区 ≤90；录屏 5 秒帧数 ≥ 140。任一不过 exit 1。基准帧 camz=44。
- verify 保证不坏，不保证好看：每步 verify 后必须用眼睛看截图，并对照艺术方向：阴影深青蓝、光钨丝暖黄、中间全黑；唯一例外是霓虹街区（品红/青两色，只在 hash<0.18 的街区）。
- verify 不过 = 未完成。不说"应该可以"，给截图和 `__stats` 数字。

## 问题日志
- 触发：verify 失败 / 甲方纠正 / 推翻自己前一方案 / 某步超预算 1.5 倍。
- 立刻在 `RETRO.md` 追加：症状 / 根因 / 修法 / 下次如何提前避免。可写成规则的同时加进本文件。

## 工作方式
- 只在 CP1–CP5 停下问甲方；其余决策自己定并写进 PLAN.md。
- 每完成一个里程碑：PLAN.md 标 ✅ + 实际用时，commit。
- M3 硬止损 25 分钟：到时 commit 已完成部分，记下停在哪，进 M4。
- 黑屏：改三次不对就输出步数/命中距离灰度图定位。品红：找源头加保护不遮。fps 崩：先关体积光再关反射二分。
- 上下文快满：先写 `HANDOFF.md`（状态/已知问题/下一步/GLSL 函数名/uniform 列表/当前里程碑）。
- 每个里程碑开始和 commit 前跑 `date`，用真实时间写 PLAN.md，不估。
- 全局副作用变量（如 gMat）必须在产生它的调用后立刻消费，法线/AO 采样都会覆盖它。
- 夜景第一版先定 3 个线性亮度锚点（天空最亮处 / 受光面 / 背光面），再填参数。
- verify 和 commit 不写在同一条管道里（grep 会吞退出码）；commit 前最近一次输出必须含 VERIFY PASS。
- GLSL 哈希只用整数哈希（uint 混洗），禁止 fract(sin)/fract(大数乘积)；verify 里保留同 URL 两次加载做差的确定性检查。
- fps 突然掉一半：先用上一 commit 的 index.html 跑一次基线，区分代码和环境。
- verify 前看 pmset -g batt：电池模式下 fps 数字不算数。

## 播放器（M11）
- `music/` 放 mp3；`node tools/scan-music.mjs` 生成 `music/manifest.json`（文件名解析歌手/曲名 + afinfo 量时长）。加 `--lyrics` 顺带检查歌词能否命中。
- 页面走 http 时读 manifest；拖进来的文件存 IndexedDB，跨会话保留。歌词按 (曲名, 歌手, 时长) 查 lrclib，先精确后搜索，必须歌手对得上才接受（同名歌很多），结果缓存进 IndexedDB。
- 中英双语文件名会拆成中文段和英文段分别尝试。
- 音频文件不进仓库（.gitignore）。歌词只做运行时查询和本地缓存，不写进仓库。
- 键位：空格 播放/暂停，L 歌单，← → 切歌，F 全屏，S 存帧，H 隐藏，R 录 30s。
- 叠加层（文字/UI）按最终可见区定位（扣掉 2.39:1 黑边），不按画布；verify 窗口不能只有 1720x720 这一个刚好 2.39 的尺寸。
- 跟随媒体时间的显示（歌词等）挂在媒体时钟上（timeupdate + 独立定时器），绝不挂渲染循环；渲染只在 `document.hidden` 时暂停，`blur` 不暂停。
- `if (!TEST)` 包裹的代码 verify 覆盖不到：verify 必须另有一条不带 test 参数的真实页面冒烟检查（pageerror 即失败 + 歌单/歌词断言）。
- 本地服务用 `npm run serve`（tools/serve.mjs，支持 Range）；python http.server 会让音频跳转静默失败。
- 任何按距离的硬分支（景深阈值、LOD、效果开关）都会在屏幕上画出一条弧——等距面在平面上是圆锥曲线。一律用 smoothstep 过渡。
- 抗锯齿在色调映射之后做；在 HDR 上做 FXAA 会把高光沿边缘拖成 1 像素镶边。TAA 开启时不要再叠 FXAA。
- 二分调试时确认调试输出真的跳过了被测代码（`fetchScene` 里藏着 FXAA 和景深，"只输出场景"并不等于绕过后期）。
- 指标失败先问「它测的是不是我真正关心的东西」：代理指标（亮斑数量）会被几何多样性误伤，直接指标（亮部面积占比 ≤1.6%）不会。抬阈值前必须先拿证据证明意图没被破坏。
- 录屏帧数和 fps 同属吞吐量测量，FPS_SOFT 下只报告不失败。
- 调了三轮参数没进展时，问的不该是「参数对不对」而是「表达这个东西的渠道选对了吗」（玻璃靠开窗方式读，不靠反射强度）。
- 面积类指标超标先分清是数量多还是单个太亮/太大，修法相反。

## 离线交付（M14）
- `npm run scan` 生成 music/manifest.json；`npm run lyrics` 把逐行歌词取到 music/*.lrc（页面走 http 时优先读它，不再联网）。
- `npm run bundle` 产出 `nightcity.html`：把两首歌（base64 data URI）、歌词和 three.js 全部内嵌。**双击即可离线播放并显示歌词**。
- 为什么必须内嵌：Chrome 给每个 file:// 文档独立的不透明源，双击打开的页面读不到同目录的 mp3——fetch 和 `<audio>` 都不行。
- `nightcity.html` 和 `music/` 里的音频都不进仓库（.gitignore）。
