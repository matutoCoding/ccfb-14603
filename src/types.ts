// 全局领域类型 —— 毛茶批次 / 焙窟焙笼 / 焙火记录 / 师傅档案 / 单颗茶颗粒

/** 做青工艺 */
export type GreenCraft = '清香型' | '韵香型' | '浓香型';
/** 焙火档位（厂内三档标准） */
export type FireGrade = '轻火' | '中火' | '足火';
/** 会话阶段 */
export type SessionPhase = 'roast' | 'cool';
/** 节点类型 */
export type NodeKind = 'turn' | 'pressAsh' | 'start' | 'end';

/** 毛茶批次 */
export interface TeaBatch {
  id: string;
  name: string;
  variety: string;          // 品种：铁观音
  mountain: string;         // 山场
  craft: GreenCraft;        // 做青工艺
  moisturePct: number;      // 含水率 %
  tightness: number;        // 条索紧结度 0..1
  basketDiameterCm: number; // 焙笼内径 cm（用于算铺茶厚度）
  teaLoadKg: number;        // 一笼放几斤（公斤）
  layerThicknessCm: number; // 自动算出的铺茶厚度 cm
  pelletCount: number;      // 本笼颗粒数（默认 5000）
  createdAt: number;
  note?: string;
}

/** 炭的种类 */
export type CharcoalKind = '荔枝木炭' | '龙眼木炭' | '枣木炭' | '硬杂木炭';

/** 焙窟 + 焙笼配置 */
export interface BasketConfig {
  id: string;
  name: string;
  pitDiameterCm: number;    // 焙窟口径
  pitDepthCm: number;       // 焙窟深度
  basketDiameterCm: number; // 焙笼内径
  basketHeightCm: number;   // 焙笼高度
  gapToCharcoalCm: number;  // 笼底距炭面高度
  charcoal: CharcoalKind;
  charcoalKg: number;       // 炭量
  ashThicknessCm: number;   // 盖灰厚度
  note?: string;
}

/** 时间轴上的可编辑节点 */
export interface RoastNode {
  id: string;
  tSec: number;             // 相对本会话开始的秒数
  kind: NodeKind;
  firePower?: number;       // 该时刻起的火力 0..1
  ashThicknessCm?: number;  // 压灰后的盖灰厚度（pressAsh）
  label?: string;
  source?: 'plan' | 'handwritten'; // 计划节点 / 照师傅手写记录录入
}

/** 一次焙火会话：roast=上焙，cool=出焙摊凉 */
export interface RoastSession {
  id: string;
  phase: SessionPhase;
  startOffsetSec: number;   // 相对记录起点的开始时间
  durationSec: number;
  firePower: number;        // roast 会话的基准火力（节点可覆盖）
  ashThicknessCm: number;   // 初始盖灰厚度
  nodes: RoastNode[];       // 翻焙/压灰等节点（按 tSec 排序）
}

/** 单颗粒温度历程采样点（轻量，纯数据可存 IDB） */
export interface PelletSample {
  t: number;  // 相对记录起点秒
  temp: number;
  heat: number;
}

/** 焙火记录（一次完整的焙：可能含初焙+摊凉+复焙多个会话） */
export interface RoastRecord {
  id: string;
  code: string;             // 批次编号，如 TB-2026-001
  batchId: string;
  basketId: string;
  masterId: string;
  targetGrade: FireGrade;
  sessions: RoastSession[];
  pelletCount: number;
  totalDurationSec: number;
  followMasterId?: string;  // 照哪位老师傅的曲线焙
  handwrittenNote?: string; // 手写记录原文
  createdAt: number;
  /** 仿真产物（运行/复现后填充，大数据，单独存一条 blob 记录） */
  resultId?: string;
  /** 仿真产物摘要（列表用，避免读大对象） */
  summary?: RoastSummary;
}

/** 焙火结果摘要 */
export interface RoastSummary {
  meanHeat: number;
  stdHeat: number;
  minHeat: number;
  maxHeat: number;
  uniformPct: number;       // 均匀度：heat 落在均值 ±15% 内的颗粒占比
  scorchPct: number;        // 焦斑颗粒占比
  bottomScorchPct: number;  // 底层焦掉颗粒占比
  grade: FireGrade;         // 实际落点档位
  gradeDelta: number;       // 相对目标档位的偏移（-2..2）
  layerMean: [number, number, number]; // 上/中/下平均火功
  finalMoisturePct: number;
}

/** 单颗粒最终状态（类型化数组的对象视图，存结果 blob 用） */
export interface PelletFinal {
  heat: number;
  scorch: number;
  maxTemp: number;
  layer: number; // 0上 1中 2下（出焙时）
}

/** 完整仿真产物（IDB 里以 resultId 单独存一条大记录） */
export interface RoastResult {
  id: string;
  recordId: string;
  pelletCount: number;
  // 初始与最终位置（米，焙笼局部坐标，y 向上）
  px: Float32Array; py: Float32Array; pz: Float32Array;
  fx: Float32Array; fy: Float32Array; fz: Float32Array;
  // 每颗粒的静态形态参数
  size: Float32Array;
  shape: Float32Array;     // 形态种子
  // 状态
  heat: Float32Array;
  scorch: Float32Array;
  maxTemp: Float32Array;
  finalLayer: Uint8Array;
  /** 初始槽位 -> 层（0上 1中 2下），供颗粒追溯按槽位 O(1) 查层 */
  slotLayer: Uint8Array;
  // 翻焙重排表：每次翻焙一条 perm，perm[旧槽位]=新槽位（颗粒 id 即初始槽位）
  turns: TurnEvent[];
  // 温度历程（列式存储，省 IndexedDB 空间）：
  // histTimes 长度 S，histTemp/histHeat 长度 S*pelletCount，第 k 次采样的第 id 颗 = arr[k*count+id]
  histTimes: Float32Array;
  histTemp: Float32Array;
  histHeat: Float32Array;
  // 全笼环境曲线（绘图用）
  envCurve: EnvSample[];
  summary: RoastSummary;
}

export interface TurnEvent {
  atSec: number;
  perm: Uint32Array;       // perm[颗粒id] = 当时槽位
  animSeed: number;
}

export interface EnvSample {
  t: number;
  centerTemp: number;      // 炭面中心温度
  edgeTemp: number;        // 边缘温度
  meanBedTemp: number;     // 茶层平均温度
  firePower: number;
  ashCm: number;
  phase: SessionPhase;
}

/** 师傅档案 */
export interface MasterProfile {
  id: string;
  name: string;
  title: string;           // 职称，如 高级评茶师
  years: number;
  specialty: string;
  signatureCurve: RoastSession; // 招牌焙火曲线（一个标准 roast 会话模板）
  typicalGrade: FireGrade;
  note?: string;
}

export interface DbSchema {
  batches: TeaBatch[];
  baskets: BasketConfig[];
  records: RoastRecord[];
  masters: MasterProfile[];
  results: RoastResult[];
}

export type StoreName = keyof DbSchema;
