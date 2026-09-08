# PLAN

开始时间：2026-09-08 19:01

## M0 · 骨架 + 验证回路（预算 15 分钟） ✅ 实际 10 分钟（19:01–19:11）
index.html：importmap three.js，全屏 quad + ShaderMaterial，resize，uniforms iTime/iResolution/uAudio/uBeat/uScale。
fragment shader 先输出渐变，预留 map()/raymarch()/calcNormal()/render()。renderScale 用小 render target 拉伸。
window.__stats 和 ?test=1。verify.mjs。
验收：verify 对渐变通过。commit `M0: skeleton + verify loop`。

## M1 · 城市 SDF + 光照 + 雾（预算 25 分钟）
方案：
- 坐标系：相机沿 +z 走街道，街道在 x 方向周期 CELL=6，z 方向周期 CELL=6；街道宽 2.2（半宽 1.1），楼体占格子内剩余。
- map(p)：id=floor(p.xz/CELL)，局部 q=p.xz-(id+0.5)*CELL；hash22(id) 给楼的半宽 (0.9–1.6) 和高度；高度 = 2 + 26*pow(h,4)（幂律，少数高楼）。
- 相机所在的街道列 (id.x==0) 不放楼，保证有路可走；楼体 sdBox(q, halfsize, height)，顶部再加一个 0.4 倍的小 box 当天台机房。
- 因为楼不超出格子（半宽 ≤ CELL/2 - 1.1），格内 SDF 对相邻格是保守的（下界），domain repetition 安全；不做邻格采样。
- 地面 y=0 平面 SDF 一起 min。
- raymarch：128 步，t 从 0 到 200，阈值 0.001*t + 0.0005，远处退出。
- 法线：四面体四采样，eps 随距离放大。
- 光：keyLight 冷蓝 (0.55,0.65,0.85) 方向 normalize(0.4,0.7,-0.3)，半兰伯特 (0.5+0.5*NdotL)^2；天空环境 hemisphere 0.5+0.5*n.y。
- AO：5 步 SDF 采样，衰减系数 0.6，不超过 0.9 的暗度。
- 雾：exp(-0.045*t)，雾色 (0.16,0.15,0.16) 比天空略暖；远楼消失。
- 天空：底部暖灰 (0.28,0.22,0.19) 到顶部近黑 (0.02,0.025,0.04)，用 pow 曲线；无星。
- 材质：楼体 albedo 低饱和蓝灰 (0.28,0.30,0.34)，地面 (0.16,0.16,0.17)；暖色点缀留给 M3 的窗户，M1 只在地平线暖色。
- 曝光：col *= 1.6 后 gamma；亮度目标非黑 >40% 由天空+雾保证。

验收：截图是像样的夜城。commit `M1: city sdf + lighting + fog`。→ CP1

## M2 · 音频管线（预算 15 分钟）
点击开始遮罩 → AudioContext。麦克风按钮；拖 mp3/wav 播放。Analyser fftSize 2048，bass/mid/high/energy，滑动最大值归一，不对称平滑（0.4/0.08）。beat：bass > 1s 滑动平均 1.4 倍且 >200ms，uBeat=1 后 8Hz 指数衰减。右下角 5 根柱子，H 隐藏。?test=1 仍合成。
commit `M2: audio pipeline`。→ CP2

## M3 · 映射 + 相机 + 体积光（预算 25 分钟，硬止损）
方案（≤15 行，进入前写）：

1. 相机沿街推进 速度 = 基础 × (0.6+0.8×energy)，横向漂移+俯仰，高度楼高 1/3
2. 楼高 × (1+0.6×bass)，每楼 hash 响应系数 0.2–1.0
3. 窗户 hash 网格，密度 0.15+0.5×high，暖色 #FFB870
4. 雾密度 = 基础 × (0.7+0.6×mid)
5. beat：射线原点径向扭曲 + 轻微曝光
6. 体积光 8 步；fps<50 减 4 步或砍
7. 地面 SDF + 湿地面反射 ≤32 步 fresnel
commit `M3: audio mapping + camera + volumetric light`。→ CP3

## M4 · 性能 + 面板（预算 15 分钟）
自适应 renderScale（<55 两秒 -0.1 下限 0.4；>59 五秒 +0.05 上限 1.0）。面板 ≤60 行：输入源、响应强度/相机速度/雾 三滑杆、beat 阈值、renderScale 显示。F 全屏 S 存 PNG H 隐藏，全屏 3 秒隐藏光标。
commit `M4: perf + panel`。→ CP4

## M5 · 对抗式审美审阅 + 录屏（预算 15 分钟）
subagent 审阅（配色/光影/动态各 ≤3 条），修影响最大 3 条。R 键 MediaRecorder 30 秒 webm 8Mbps。
commit `M5: polish after review`。→ CP5

## 决策记录
