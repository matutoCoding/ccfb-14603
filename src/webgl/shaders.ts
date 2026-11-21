// 全部 GLSL 着色器源码（WebGL2 / GLSL ES 3.00），火功配色 GLSL 与 JS 共用同一套约定

// ---------- 公用 ----------
const HEAT_RAMP_GLSL = /* glsl */ `
// 火功配色：青褐 -> 乌褐 -> 黑褐（分界与 temperature.ts 的 GRADE_BOUNDS 对齐）
vec3 heatRamp(float h) {
  vec3 green = vec3(0.43, 0.34, 0.20);
  vec3 dark  = vec3(0.23, 0.13, 0.08);
  vec3 black = vec3(0.07, 0.05, 0.04);
  vec3 c = mix(green, dark, smoothstep(0.0, 1.0, h / 1.25));
  c = mix(c, black, smoothstep(1.25, 1.9, h));
  return c;
}
// 油润度：随火功先升后降，中火附近最润
float oiliness(float h) {
  return 0.12 + 0.55 * exp(-pow((h - 0.62) / 0.55, 2.0));
}
// 简易 3D 值噪声（颗粒表面焦斑用）
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1,0,0));
  float n010 = hash31(i + vec3(0,1,0));
  float n110 = hash31(i + vec3(1,1,0));
  float n001 = hash31(i + vec3(0,0,1));
  float n101 = hash31(i + vec3(1,0,1));
  float n011 = hash31(i + vec3(0,1,1));
  float n111 = hash31(i + vec3(1,1,1));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}
`;

const CLIP_GLSL = /* glsl */ `
uniform vec4 uClipPlane; // 世界空间裁剪平面 (abc,d)，uClipPlane·p >= 0 保留
void applyClip(vec3 worldPos) {
  if (dot(uClipPlane.xyz, worldPos) + uClipPlane.w < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

// ---------- 茶颗粒 ----------
export const PELLET_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 iOffset;
layout(location=3) in float iSize;
layout(location=4) in float iShape;
layout(location=5) in vec2 iState; // x=heat y=scorch
layout(location=6) in float iPick; // 拾取 id（0 表示正常绘制）
uniform mat4 uVP;
uniform float uTurnMix;   // 翻焙动画 0..1
uniform float uTurnSeed;
out vec3 vWorld;
out vec3 vNor;
out vec2 vState;
out float vShape;
out float vPick;
${CLIP_GLSL}
void main() {
  vec3 p = aPos;
  // 程序化卷曲：按形态种子做不均匀缩皱
  float w = sin(p.x * 6.0 + iShape) * sin(p.y * 5.0 + iShape * 1.7) * 0.12;
  p *= 1.0 + w;
  p.y *= 0.82; // 压扁成颗粒状
  vec3 world = iOffset + p * iSize;
  // 翻焙时整体抛起扰动（视觉用，不改数据）
  float a = iShape * 12.9898;
  world.y += sin(uTurnMix * 3.14159) * (0.04 + 0.05 * fract(sin(a) * 43758.5));
  world.x += sin(uTurnMix * 3.14159 + a) * 0.012 * uTurnMix;
  vWorld = world;
  vNor = aNor;
  vState = iState;
  vShape = iShape;
  vPick = iPick;
  vec4 clip = uVP * vec4(world, 1.0);
  gl_Position = clip;
  applyClip(world);
}
`;

export const PELLET_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec2 vState;
in float vShape;
in float vPick;
uniform vec3 uCamPos;
uniform float uPicking;
out vec4 frag;
${HEAT_RAMP_GLSL}
void main() {
  if (uPicking > 0.5) {
    // id -> RGB（RGB8 可编码 1600 万，颗粒数上限足够）
    float id = vPick;
    float r = mod(id, 256.0);
    float g = mod(floor(id / 256.0), 256.0);
    float b = floor(id / 65536.0);
    frag = vec4(vec3(r, g, b) / 255.0, 1.0);
    return;
  }
  float heat = vState.x;
  float scorch = vState.y;
  vec3 base = heatRamp(heat);

  // 焦斑：噪声斑块，边缘（法线水平分量大处）先焦
  float n = vnoise(vWorld * 260.0 + vec3(vShape));
  float edge = smoothstep(0.25, 0.85, 1.0 - abs(vNor.y));
  float spot = smoothstep(0.62, 0.85, n * 0.7 + edge * 0.45) * smoothstep(0.05, 0.5, scorch);
  vec3 col = mix(base, vec3(0.025, 0.018, 0.014), clamp(spot + scorch * 0.35, 0.0, 1.0));

  // 油润高光
  vec3 V = normalize(uCamPos - vWorld);
  vec3 L = normalize(vec3(0.5, 1.0, 0.35));
  float diff = max(dot(normalize(vNor), L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(normalize(vNor), H), 0.0), 26.0) * oiliness(heat);
  col *= 0.55 + 0.55 * diff;
  col += spec * vec3(0.9, 0.75, 0.5);
  frag = vec4(col, 1.0);
}
`;

// ---------- 炭面 / 灰层热力圆盘 ----------
export const HEATDISC_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vLocal;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vLocal = aPos;
  gl_Position = uVP * world;
}
`;

export const HEATDISC_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vLocal;
uniform float uRadius;
uniform float uCenterTemp;
uniform float uEdgeTemp;
uniform float uAsh;
uniform float uMode; // 0=炭面热力 1=灰层 2=剖面色带
uniform float uHeatMax;
out vec4 frag;
vec3 heatColor(float t) {
  // 温度：暗红 -> 橙红 -> 亮橙黄
  vec3 a = vec3(0.18, 0.02, 0.01);
  vec3 b = vec3(0.75, 0.12, 0.02);
  vec3 c = vec3(1.0, 0.55, 0.12);
  float k = clamp((t - 100.0) / 560.0, 0.0, 1.0);
  vec3 col = mix(a, b, smoothstep(0.0, 0.6, k));
  col = mix(col, c, smoothstep(0.5, 1.0, k));
  return col;
}
vec3 fireBand(float h) {
  vec3 green = vec3(0.43, 0.34, 0.20);
  vec3 dark  = vec3(0.23, 0.13, 0.08);
  vec3 black = vec3(0.07, 0.05, 0.04);
  vec3 col = mix(green, dark, smoothstep(0.0, 1.0, h / 1.15));
  return mix(col, black, smoothstep(1.15, 1.8, h));
}
void main() {
  float nr = length(vLocal.xz) / uRadius;
  if (uMode < 1.5) {
    float t = mix(uCenterTemp, uEdgeTemp, pow(nr, 1.4));
    if (uMode > 0.5) {
      // 灰层：灰白色，缝隙里透底下的红光
      vec3 ash = vec3(0.52, 0.50, 0.47) * (0.85 + 0.15 * sin(nr * 90.0));
      vec3 glow = heatColor(t) * 0.6;
      float cover = clamp(0.82 - uAsh * 0.04, 0.45, 0.9);
      frag = vec4(mix(glow, ash, cover), 1.0);
    } else {
      frag = vec4(heatColor(t), 1.0);
    }
  } else {
    // 剖面色带：按半径映射火功（由 JS 传入当前剖面的层均值近似）
    float h = (1.0 - nr) * uHeatMax;
    frag = vec4(fireBand(h), 1.0);
  }
}
`;

// ---------- 竹笼 / 焙窟 / 地面 通用材质 ----------
export const STANDARD_VS = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vWorld;
out vec3 vNor;
out vec3 vLocal;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNor = mat3(uModel) * aNor;
  vLocal = aPos;
  gl_Position = uVP * world;
}
`;

export const STANDARD_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vLocal;
uniform vec3 uColor;
uniform float uKind; // 0=普通 1=竹编条纹 2=地面网格 3=砖窟 4=笼箅
uniform vec3 uCamPos;
out vec4 frag;
void main() {
  vec3 col = uColor;
  if (uKind > 0.5 && uKind < 1.5) {
    // 竹编：竖向细条 + 横向箍纹
    float ang = atan(vLocal.z, vLocal.x);
    float vertical = 0.5 + 0.5 * sin(ang * 36.0);
    float horizontal = 0.5 + 0.5 * sin(vLocal.y * 140.0);
    float weave = vertical * 0.5 + horizontal * 0.5;
    col *= 0.78 + 0.35 * weave;
  } else if (uKind > 1.5 && uKind < 2.5) {
    vec2 g = abs(fract(vWorld.xz * 2.0) - 0.5);
    float line = smoothstep(0.46, 0.5, max(g.x, g.y));
    col = mix(col, vec3(0.28, 0.24, 0.20), line * 0.6);
  } else if (uKind > 2.5 && uKind < 3.5) {
    // 砖窟：环向砖缝
    float rows = 0.5 + 0.5 * sin(vLocal.y * 60.0);
    float ang = atan(vLocal.z, vLocal.x);
    float bricks = 0.5 + 0.5 * sin(ang * 24.0 + floor(vLocal.y * 30.0));
    float seam = max(smoothstep(0.45, 0.5, rows), smoothstep(0.47, 0.5, bricks) * 0.6);
    col *= 1.0 - seam * 0.35;
    // 靠炭面的热辐射红
    float glow = smoothstep(-0.25, 0.12, vLocal.y);
    col += vec3(0.35, 0.06, 0.01) * glow * 0.5;
  } else if (uKind > 3.5) {
    // 笼箅：放射状竹栅条，缝隙变暗
    float ang = atan(vLocal.z, vLocal.x);
    float bars = smoothstep(0.35, 0.5, 0.5 + 0.5 * sin(ang * 44.0));
    col *= 0.35 + 0.75 * bars;
  }
  vec3 L = normalize(vec3(0.5, 1.0, 0.35));
  float diff = 0.5 + 0.5 * max(dot(normalize(vNor), L), 0.0);
  frag = vec4(col * diff, 1.0);
}
`;

// 供 JS 侧复用的火功色带（剖面图例 / 分布图 / 颗粒详情）
export function heatRampJS(h: number): [number, number, number] {
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const green: [number, number, number] = [0.43, 0.34, 0.2];
  const dark: [number, number, number] = [0.23, 0.13, 0.08];
  const black: [number, number, number] = [0.07, 0.05, 0.04];
  const t1 = clamp01(h / 1.25);
  let c = green.map((g, i) => g + (dark[i] - g) * t1);
  const t2 = clamp01((h - 1.25) / 0.65);
  c = c.map((v, i) => v + (black[i] - v) * t2);
  return [c[0], c[1], c[2]];
}
