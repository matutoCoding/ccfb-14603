// 静态结果适配器：把已存盘的 RoastResult 包装成场景可回放的数据源（时间拖动/复焙对比用）
import type { RoastResult } from '../types';

export interface SceneFrame {
  t: number;
  x: Float32Array; y: Float32Array; z: Float32Array;
  heat: Float32Array;
  scorch: Float32Array;
}

export interface SceneAdapter {
  count: number;
  totalT: number;
  readonly sizes: Float32Array;
  readonly shapes: Float32Array;
  frameAt(t: number): SceneFrame;
  historyAt(pelletId: number, t: number): { temp: number; heat: number };
  initial(): SceneFrame;
}

/**
 * 实时引擎适配器（roast 页面）：每帧从引擎当前状态取快照
 */
export class LiveAdapter implements SceneAdapter {
  count: number;
  totalT: number;
  private engine: import('../sim/engine').RoastEngine;
  private x: Float32Array; private y: Float32Array; private z: Float32Array;
  private zero: Float32Array;
  readonly sizes: Float32Array;
  readonly shapes: Float32Array;

  constructor(engine: import('../sim/engine').RoastEngine, totalT: number) {
    this.engine = engine;
    this.count = engine.count;
    this.totalT = totalT;
    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.zero = new Float32Array(this.count);
    this.sizes = engine.bed.sizes;
    this.shapes = engine.bed.shapes;
  }

  /** 从头重跑时替换引擎（形态数组同一 RNG 种子，保持一致） */
  setEngine(engine: import('../sim/engine').RoastEngine): void {
    this.engine = engine;
  }

  initial(): SceneFrame {
    const e = this.engine;
    return { t: 0, x: e.bed.px.slice(), y: e.bed.py.slice(), z: e.bed.pz.slice(), heat: this.zero.slice(), scorch: this.zero.slice() };
  }

  frameAt(): SceneFrame {
    const e = this.engine;
    e.fillPositions(this.x, this.y, this.z);
    return { t: e.t, x: this.x, y: this.y, z: this.z, heat: e.heat, scorch: e.scorch };
  }

  historyAt(pelletId: number): { temp: number; heat: number } {
    return { temp: this.engine.temp[pelletId], heat: this.engine.heat[pelletId] };
  }
}

/**
 * 静态适配器：按时间在采样帧间插值；
 * 位置在翻焙时刻做整段切换（槽位重排本就是瞬时动作），保证颗粒不丢不重。
 */
export class StaticAdapter implements SceneAdapter {
  count: number;
  totalT: number;
  private r: RoastResult;
  private x: Float32Array; private y: Float32Array; private z: Float32Array;
  private posCache = new Map<number, { x: Float32Array; y: Float32Array; z: Float32Array }>();
  readonly sizes: Float32Array;
  readonly shapes: Float32Array;

  constructor(r: RoastResult) {
    this.r = r;
    this.count = r.pelletCount;
    this.totalT = r.histTimes[r.histTimes.length - 1] ?? 0;
    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.sizes = r.size;
    this.shapes = r.shape;
  }

  initial(): SceneFrame {
    const r = this.r;
    return {
      t: 0,
      x: r.px.slice(), y: r.py.slice(), z: r.pz.slice(),
      heat: new Float32Array(this.count),
      scorch: new Float32Array(this.count),
    };
  }

  /** 第 k 个采样帧时，每个颗粒 id 所在槽位的位置 */
  private positionsAtFrame(k: number) {
    const cached = this.posCache.get(k);
    if (cached) return cached;
    const r = this.r;
    const n = this.count;
    // 统计截至该帧已发生的翻焙，逐级还原 slotOf
    const slot = new Uint32Array(n);
    for (let id = 0; id < n; id++) slot[id] = id;
    for (const turn of r.turns) {
      if (turn.atSec > r.histTimes[k] + 1e-3) break;
      for (let id = 0; id < n; id++) slot[id] = turn.perm[slot[id]];
    }
    const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
    for (let id = 0; id < n; id++) {
      const s = slot[id];
      x[id] = r.px[s]; y[id] = r.py[s]; z[id] = r.pz[s];
    }
    const out = { x, y, z };
    if (this.posCache.size < 64) this.posCache.set(k, out);
    return out;
  }

  frameAt(t: number): SceneFrame {
    const r = this.r;
    const times = r.histTimes;
    let k1 = 0;
    while (k1 < times.length - 1 && times[k1 + 1] <= t) k1++;
    const k2 = Math.min(k1 + 1, times.length - 1);
    const t1 = times[k1], t2 = times[k2];
    const a = t2 > t1 ? Math.max(0, Math.min(1, (t - t1) / (t2 - t1))) : 0;
    const n = this.count;
    const p1 = this.positionsAtFrame(k1);
    const heat = new Float32Array(n);
    for (let id = 0; id < n; id++) {
      heat[id] = r.histHeat[k1 * n + id] * (1 - a) + r.histHeat[k2 * n + id] * a;
    }
    // 焦斑没有逐帧快照，用最终值按整体火功进度比例近似（仅影响视觉，可追溯数据以历程为准）
    const progress = t / Math.max(1, this.totalT);
    const scorch = new Float32Array(n);
    for (let id = 0; id < n; id++) scorch[id] = r.scorch[id] * progress;
    // 位置：若两帧间发生翻焙则直接取后段位置（瞬时重排），否则不动
    const p2 = this.positionsAtFrame(k2);
    const samePos = p1 === p2;
    if (samePos) {
      this.x.set(p1.x); this.y.set(p1.y); this.z.set(p1.z);
    } else {
      this.x.set(p2.x); this.y.set(p2.y); this.z.set(p2.z);
    }
    return { t, x: this.x, y: this.y, z: this.z, heat, scorch };
  }

  historyAt(pelletId: number, t: number): { temp: number; heat: number } {
    const r = this.r;
    const times = r.histTimes;
    let k = 0;
    while (k < times.length - 1 && times[k + 1] <= t) k++;
    const k2 = Math.min(k + 1, times.length - 1);
    const n = this.count;
    const t1 = times[k], t2 = times[k2];
    const a = t2 > t1 ? (t - t1) / (t2 - t1) : 0;
    return {
      temp: r.histTemp[k * n + pelletId] * (1 - a) + r.histTemp[k2 * n + pelletId] * a,
      heat: r.histHeat[k * n + pelletId] * (1 - a) + r.histHeat[k2 * n + pelletId] * a,
    };
  }
}
