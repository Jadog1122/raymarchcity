# raymarchcity — 工作规则

## 硬约束
- 产物只有 `index.html`（内联 GLSL）。`verify.mjs` / `PLAN.md` / `RETRO.md` / `HANDOFF.md` 是开发文件。
- 除 three.js importmap CDN（锁定版本号）外零外部依赖；最终产物 `file://` 双击可开。
- 所有画面在一个 fragment shader 里；three.js 只做全屏 quad + uniforms，相机在 shader 里算，不用 OrbitControls。
- fps 上限 60；页面失焦暂停渲染。
- 音频初始化全部在用户手势事件里（AudioContext autoplay 限制）。
- shader 中任何 NaN 输出纯品红 `#FF00FF`。
- Retina DPR=2：renderScale 基于 CSS 像素，默认 0.75，绝不再乘 DPR。
- 开发用本地 http 服务（file:// 下 Chrome 可能拒麦克风）。

## 验证（每次改 shader 必跑）
- `npm run verify` = `node verify.mjs`：有头 chromium，deviceScaleFactor 2，窗口 1720x720，打开 `index.html?test=1`。
- `?test=1`：iTime 固定 8.0，音频 uniforms 用 sin(t) 合成，随机种子固定，不请求麦克风。
- 等 3 秒读 `window.__stats`（fps/frameMs/shaderError/renderScale/rt 尺寸/DPR/GPU），截图 `shots/latest.png` + `shots/M<n>-<hhmm>.png`。
- 通过：shaderError 空；fps ≥ 50；非黑像素 > 40%；品红 < 0.1%。任一不过 exit 1。
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
