# PLAN

开始时间：2026-09-08 19:01

## M0 · 骨架 + 验证回路（预算 15 分钟）
index.html：importmap three.js，全屏 quad + ShaderMaterial，resize，uniforms iTime/iResolution/uAudio/uBeat/uScale。
fragment shader 先输出渐变，预留 map()/raymarch()/calcNormal()/render()。renderScale 用小 render target 拉伸。
window.__stats 和 ?test=1。verify.mjs。
验收：verify 对渐变通过。commit `M0: skeleton + verify loop`。

## M1 · 城市 SDF + 光照 + 雾（预算 25 分钟）
方案（≤15 行，进入前写）：

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
