// 炭焙温度场模型 —— 全部为可解释的经验公式，参数对应师傅口中的"炭火"
// 设计目标：
//  1) 炭面中心最旺，径向向外递减；盖灰越厚，整体降温且径向越平
//  2) 茶层内热空气向上，底层最热、顶层次之，中间略有衰减
//  3) 压灰即时削峰、摊凉按指数回归室温

export interface FireState {
  firePower: number;      // 0..1 炭火旺盛度
  ashCm: number;          // 当前盖灰厚度 cm
  phase: 'roast' | 'cool';
}

/** 炭面中心温度（℃） */
export function charcoalCenterTemp(fire: FireState): number {
  if (fire.phase === 'cool') return 28;
  // 裸炭旺火约 620℃，压灰按指数衰减
  const bare = 240 + 380 * fire.firePower;
  const ashFactor = Math.exp(-0.16 * fire.ashCm);
  return 28 + (bare - 28) * ashFactor;
}

/**
 * 径向温度分布系数 0..1。
 * 灰越厚，径向梯度越平（热被灰层均化）。
 */
export function radialFactor(nr: number, ashCm: number): number {
  const sharpness = 1.6 * Math.exp(-0.18 * ashCm); // 无灰时陡，厚灰时平
  const v = Math.exp(-sharpness * nr * nr);
  return v;
}

/** 茶床某半径处的笼下进气温度（℃） */
export function bedInletTemp(nr: number, fire: FireState): number {
  if (fire.phase === 'cool') return 28;
  const center = charcoalCenterTemp(fire);
  // 经过笼底间距与茶层遮挡后的工作温度，约为炭温的 26%~36%（真实焙茶茶层 95~140℃）
  const workRatio = 0.27 + 0.09 * fire.firePower;
  const edgeFloor = 0.55 + 0.05 * fire.ashCm; // 厚灰时边缘也不冷
  const f = edgeFloor + (1 - edgeFloor) * radialFactor(nr, fire.ashCm);
  return 28 + (center - 28) * workRatio * f;
}

/**
 * 垂直系数：热气向上，但颗粒直接接触笼箅的底层受热最强。
 * nh 为床内归一化高度（0 底，1 顶）。整体带形收窄，保证翻焙后均匀度可控。
 */
export function verticalFactor(nh: number): number {
  // 底层 ~1.08，中层 ~0.94，顶层 ~0.99
  const bottom = 0.14 * Math.exp(-3.2 * nh);
  const middle = 0.94;
  const top = 0.05 * nh * nh;
  return middle + bottom + top;
}

/** 某颗粒在给定床层位置的稳态环境温度（℃） */
export function pelletEnvTemp(nr: number, nh: number, fire: FireState): number {
  if (fire.phase === 'cool') return 28;
  const inlet = bedInletTemp(nr, fire);
  return 28 + (inlet - 28) * verticalFactor(nh);
}

/** 颗粒温度一阶滞后更新（τ 约 75 秒，茶是热的不良导体） */
export function updatePelletTemp(current: number, target: number, dtSec: number): number {
  const tau = 75;
  const a = 1 - Math.exp(-dtSec / tau);
  return current + (target - current) * a;
}

/** 积火功：温度超过 80℃ 才开始累积，按 (T-80)² 加权；105℃ 焙 4h≈0.35 轻火，118℃ 焙 6h≈0.85 中火 */
export function accumulateHeat(heat: number, tempC: number, dtSec: number): number {
  if (tempC <= 80) return heat;
  const rate = 4.7e-8 * (tempC - 80) ** 2; // /s
  return heat + rate * dtSec;
}

/** 焦损累积：超过 138℃ 才开始（正常焙茶窗口 95~132℃ 不焦），底层位置有额外加成 */
export function accumulateScorch(scorch: number, tempC: number, nh: number, dtSec: number): number {
  if (tempC <= 138) return scorch;
  const bottomBoost = 1 + 1.6 * Math.exp(-3.5 * nh); // 底层更易焦
  const rate = 1.4e-5 * Math.pow(tempC - 138, 1.8) * bottomBoost;
  return Math.min(1, scorch + rate * dtSec);
}

/** 厂内三档火功的 heat 阈值（对本模型标定） */
export const GRADE_BOUNDS = {
  lightMax: 0.62,
  mediumMax: 1.25,
  // > 1.25 即足火区间，> 1.8 视为过火
  overFire: 1.8,
} as const;

export function gradeOfHeat(heat: number): '轻火' | '中火' | '足火' {
  if (heat < GRADE_BOUNDS.lightMax) return '轻火';
  if (heat < GRADE_BOUNDS.mediumMax) return '中火';
  return '足火';
}

/** 三档标准中心值，用于对比偏档 */
export const GRADE_CENTER: Record<'轻火' | '中火' | '足火', number> = {
  轻火: 0.36,
  中火: 0.92,
  足火: 1.52,
};

export function gradeDelta(meanHeat: number, target: '轻火' | '中火' | '足火'): number {
  // 负值=偏嫩（火不足），正值=偏老（火过头），单位为"档"
  const actual = gradeOfHeat(meanHeat);
  const order = ['轻火', '中火', '足火'] as const;
  const d = order.indexOf(actual) - order.indexOf(target);
  if (d === 0) {
    // 同档内再给细偏：靠近档界则 ±0.4
    const c = GRADE_CENTER[target];
    return Math.max(-0.4, Math.min(0.4, (meanHeat - c) / (GRADE_BOUNDS.mediumMax - GRADE_BOUNDS.lightMax)));
  }
  return d;
}
