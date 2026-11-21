// 焙火仿真引擎：时间轴步进 + 翻焙重排（颗粒不丢不重）+ 逐颗粒火功/焦损累积 + 历程采样
import { Rng, shuffledPerm, assertPermutation } from './rng';
import { buildBed, type BedGeometry } from './geometry';
import {
  pelletEnvTemp, updatePelletTemp, accumulateHeat, accumulateScorch,
  gradeOfHeat, gradeDelta, type FireState,
} from './temperature';
import type {
  RoastResult, RoastSession, RoastSummary, TurnEvent, EnvSample,
  PelletSample, FireGrade, RoastNode,
} from '../types';

export interface EngineInput {
  recordId: string;
  pelletCount: number;
  bedRadiusM: number;
  bedThicknessM: number;
  sessions: RoastSession[];
  totalDurationSec: number;
  targetGrade: FireGrade;
  initialMoisturePct: number;
  seed: number;
}

interface TimedEvent {
  t: number;
  kind: 'sessionStart' | 'sessionEnd' | 'node';
  node?: RoastNode;
  session?: RoastSession;
}

const STEP_SEC = 10;          // 仿真步长
const HIST_INTERVAL = 120;    // 历程采样间隔（秒）
const ENV_INTERVAL = 30;      // 环境曲线采样间隔
const MAX_STEPS = 20000;      // 安全上限（约 55 小时）
const MAX_FRAMES = 4096;      // 历程帧上限（预分配，约 136 小时的 120s 采样）

export class RoastEngine {
  readonly in: EngineInput;
  private rng: Rng;
  readonly bed: BedGeometry;

  // 以颗粒 id（=初始槽位）为主键的状态
  readonly temp: Float32Array;
  readonly heat: Float32Array;
  readonly scorch: Float32Array;
  readonly maxTemp: Float32Array;
  readonly slotOf: Uint32Array;   // slotOf[颗粒id] = 当前槽位

  t = 0;
  fire: FireState = { firePower: 0.6, ashCm: 3, phase: 'roast' };
  readonly turns: TurnEvent[] = [];
  /** 最近一次翻焙的时间与动画种子（渲染器做翻动动画用） */
  lastTurnAt = -1;
  lastTurnSeed = 0;

  private events: TimedEvent[];
  private evPtr = 0;
  // 预分配的列式历程缓冲
  private histTimes: Float32Array;
  private histTemp: Float32Array;
  private histHeat: Float32Array;
  private frameCount = 0;
  private lastHistT = -1;
  private envCurve: EnvSample[] = [];
  private lastEnvT = -1;
  private moisture: number;
  private finished = false;

  constructor(input: EngineInput) {
    this.in = input;
    this.rng = new Rng(input.seed);
    this.bed = buildBed(input.pelletCount, input.bedRadiusM, input.bedThicknessM, this.rng);
    const n = input.pelletCount;
    this.temp = new Float32Array(n).fill(28);
    this.heat = new Float32Array(n);
    this.scorch = new Float32Array(n);
    this.maxTemp = new Float32Array(n);
    this.slotOf = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.slotOf[i] = i;
    this.moisture = input.initialMoisturePct;
    this.events = buildTimeline(input.sessions);
    this.histTimes = new Float32Array(MAX_FRAMES);
    this.histTemp = new Float32Array(MAX_FRAMES * n);
    this.histHeat = new Float32Array(MAX_FRAMES * n);
  }

  get count() { return this.in.pelletCount; }
  get done() { return this.finished; }
  get environmentCurve(): readonly EnvSample[] { return this.envCurve; }
  get historyTimes(): Float32Array { return this.histTimes.subarray(0, this.frameCount) as Float32Array; }
  get historyTempBuffer(): Float32Array { return this.histTemp.subarray(0, this.frameCount * this.count) as Float32Array; }
  get historyHeatBuffer(): Float32Array { return this.histHeat.subarray(0, this.frameCount * this.count) as Float32Array; }

  /** 当前每颗粒的世界位置（按槽位查表） */
  fillPositions(outX: Float32Array, outY: Float32Array, outZ: Float32Array): void {
    const { px, py, pz } = this.bed;
    for (let id = 0; id < this.count; id++) {
      const s = this.slotOf[id];
      outX[id] = px[s]; outY[id] = py[s]; outZ[id] = pz[s];
    }
  }

  /** 推进仿真，dtSec 为仿真秒（内部按 STEP_SEC 定步长，事件边界对齐） */
  advance(dtSec: number): void {
    if (this.finished) return;
    const target = Math.min(this.in.totalDurationSec, this.t + dtSec);
    let guard = 0;
    while (this.t < target - 1e-6 && !this.finished && guard++ < MAX_STEPS) {
      this.applyDueEvents();
      const nextEvt = this.peekEventTime();
      let step = Math.min(STEP_SEC, target - this.t);
      if (nextEvt != null && nextEvt > this.t + 1e-6) step = Math.min(step, nextEvt - this.t);
      if (step <= 1e-6) { this.evPtr++; continue; }
      this.stepOnce(step);
      this.t += step;
      this.applyDueEvents();
      if (this.t >= this.in.totalDurationSec - 1e-6) this.finishRun();
    }
  }

  runToEnd(): RoastResult {
    this.advance(this.in.totalDurationSec);
    return this.buildResult();
  }

  // ---------- 内部 ----------

  private peekEventTime(): number | null {
    return this.evPtr < this.events.length ? this.events[this.evPtr].t : null;
  }

  private applyDueEvents(): void {
    while (this.evPtr < this.events.length && this.events[this.evPtr].t <= this.t + 1e-6) {
      const e = this.events[this.evPtr++];
      if (e.kind === 'sessionStart' && e.session) {
        const s = e.session;
        this.fire = { phase: s.phase, firePower: s.firePower, ashCm: s.ashThicknessCm };
        this.snapshotHistory();
        this.snapshotEnv();
      } else if (e.kind === 'node' && e.node) {
        this.handleNode(e.node);
      } else if (e.kind === 'sessionEnd') {
        this.snapshotHistory();
      }
    }
  }

  private handleNode(node: RoastNode): void {
    if (node.kind === 'turn') {
      // 翻焙：对"槽位"做洗牌，颗粒随槽位映射迁移 —— 一条排列，不丢不重
      const perm = shuffledPerm(this.count, this.rng);
      assertPermutation(perm);
      for (let id = 0; id < this.count; id++) {
        this.slotOf[id] = perm[this.slotOf[id]];
      }
      const seed = this.rng.int(1 << 30);
      this.turns.push({ atSec: this.t, perm, animSeed: seed });
      this.lastTurnAt = this.t;
      this.lastTurnSeed = seed;
      this.snapshotHistory();
    } else if (node.kind === 'pressAsh') {
      if (node.ashThicknessCm != null) this.fire.ashCm = node.ashThicknessCm;
      if (node.firePower != null) this.fire.firePower = node.firePower;
      this.snapshotHistory();
    } else if (node.firePower != null) {
      this.fire.firePower = node.firePower;
    }
  }

  private stepOnce(dt: number): void {
    const { bed, fire } = this;
    const nr = bed.normR, nh = bed.normH, slot = this.slotOf;
    let tempSum = 0;
    for (let id = 0; id < this.count; id++) {
      const s = slot[id];
      const target = pelletEnvTemp(nr[s], nh[s], fire);
      const nt = updatePelletTemp(this.temp[id], target, dt);
      this.temp[id] = nt;
      if (nt > this.maxTemp[id]) this.maxTemp[id] = nt;
      this.heat[id] = accumulateHeat(this.heat[id], nt, dt);
      this.scorch[id] = accumulateScorch(this.scorch[id], nt, nh[s], dt);
      tempSum += nt;
    }
    const meanTemp = tempSum / this.count;
    // 含水率向 ~3.2% 的平衡含水指数衰减（铁观音焙后通常 3~5%），摊凉期缓慢回潮
    if (this.fire.phase === 'roast' && meanTemp > 60) {
      const target = 3.2;
      this.moisture = target + (this.moisture - target) * Math.exp(-9e-6 * (meanTemp - 60) * dt);
    } else if (this.fire.phase === 'cool') {
      this.moisture += (4.6 - this.moisture) * Math.min(1, 1.2e-6 * dt);
    }

    // 周期采样（摊凉期温度无变化，跳过以免产生海量冗余帧；节点事件仍各自留快照）
    if (this.fire.phase === 'roast') {
      if (this.t - this.lastHistT >= HIST_INTERVAL - 1e-6) this.snapshotHistory();
      if (this.t - this.lastEnvT >= ENV_INTERVAL - 1e-6) this.snapshotEnv();
    }
  }

  private snapshotHistory(): void {
    if (this.lastHistT === this.t || this.frameCount >= MAX_FRAMES) return; // 去重，杜绝同刻重复帧
    const off = this.frameCount * this.count;
    this.histTimes[this.frameCount] = this.t;
    this.histTemp.set(this.temp, off);
    this.histHeat.set(this.heat, off);
    this.frameCount++;
    this.lastHistT = this.t;
  }

  private snapshotEnv(): void {
    if (this.lastEnvT === this.t) return;
    const { bed, fire } = this;
    let sum = 0;
    for (let s = 0; s < this.count; s++) {
      sum += pelletEnvTemp(bed.normR[s], bed.normH[s], fire);
    }
    this.envCurve.push({
      t: this.t,
      centerTemp: pelletEnvTemp(0, 0.5, fire),
      edgeTemp: pelletEnvTemp(1, 0.5, fire),
      meanBedTemp: sum / this.count,
      firePower: fire.firePower,
      ashCm: fire.ashCm,
      phase: fire.phase,
    });
    this.lastEnvT = this.t;
  }

  private finishRun(): void {
    if (this.finished) return;
    this.finished = true;
    this.snapshotHistory();
    this.snapshotEnv();
  }

  private buildResult(): RoastResult {
    const n = this.count;
    const fx = new Float32Array(n), fy = new Float32Array(n), fz = new Float32Array(n);
    this.fillPositions(fx, fy, fz);
    const finalLayer = new Uint8Array(n);
    for (let id = 0; id < n; id++) finalLayer[id] = this.bed.layer[this.slotOf[id]];

    const frames = this.frameCount;
    const result: RoastResult = {
      id: `result-${this.in.recordId}`,
      recordId: this.in.recordId,
      pelletCount: n,
      px: this.bed.px.slice(), py: this.bed.py.slice(), pz: this.bed.pz.slice(),
      fx, fy, fz,
      size: this.bed.sizes.slice(),
      shape: this.bed.shapes.slice(),
      heat: this.heat.slice(),
      scorch: this.scorch.slice(),
      maxTemp: this.maxTemp.slice(),
      finalLayer,
      slotLayer: this.bed.layer.slice(),
      turns: this.turns,
      histTimes: this.histTimes.slice(0, frames),
      histTemp: this.histTemp.slice(0, frames * n),
      histHeat: this.histHeat.slice(0, frames * n),
      envCurve: this.envCurve,
      summary: this.buildSummary(finalLayer),
    };
    return result;
  }

  private buildSummary(finalLayer: Uint8Array): RoastSummary {
    const n = this.count;
    let sum = 0, min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { sum += this.heat[i]; min = Math.min(min, this.heat[i]); max = Math.max(max, this.heat[i]); }
    const mean = sum / n;
    let varSum = 0, uniform = 0, scorched = 0;
    const layerSum = [0, 0, 0]; const layerN = [0, 0, 0];
    let bottomN = 0, bottomScorched = 0;
    for (let i = 0; i < n; i++) {
      const d = this.heat[i] - mean;
      varSum += d * d;
      if (Math.abs(d) <= mean * 0.15) uniform++;
      if (this.scorch[i] > 0.35) scorched++;
      const L = finalLayer[i];
      layerSum[L] += this.heat[i]; layerN[L]++;
      if (L === 2) { bottomN++; if (this.scorch[i] > 0.35) bottomScorched++; }
    }
    const grade = gradeOfHeat(mean);
    return {
      meanHeat: mean,
      stdHeat: Math.sqrt(varSum / n),
      minHeat: min, maxHeat: max,
      uniformPct: (uniform / n) * 100,
      scorchPct: (scorched / n) * 100,
      bottomScorchPct: bottomN ? (bottomScorched / bottomN) * 100 : 0,
      grade,
      gradeDelta: gradeDelta(mean, this.in.targetGrade),
      layerMean: [
        layerN[0] ? layerSum[0] / layerN[0] : 0,
        layerN[1] ? layerSum[1] / layerN[1] : 0,
        layerN[2] ? layerSum[2] / layerN[2] : 0,
      ],
      finalMoisturePct: this.moisture,
    };
  }
}

/** 把会话与节点展开为全局时间线事件 */
function buildTimeline(sessions: RoastSession[]): TimedEvent[] {
  const events: TimedEvent[] = [];
  const sorted = [...sessions].sort((a, b) => a.startOffsetSec - b.startOffsetSec);
  for (const s of sorted) {
    const start = s.startOffsetSec;
    const end = start + s.durationSec;
    events.push({ t: start, kind: 'sessionStart', session: s });
    for (const node of s.nodes) {
      events.push({ t: start + Math.max(0, Math.min(node.tSec, s.durationSec)), kind: 'node', node });
    }
    events.push({ t: end, kind: 'sessionEnd', session: s });
  }
  events.sort((a, b) => a.t - b.t);
  return events;
}

/** 从结果中取单颗粒温度历程（可追溯：进笼到出焙） */
export function getPelletHistory(result: RoastResult, pelletId: number): PelletSample[] {
  const n = result.pelletCount;
  const frames = result.histTimes.length;
  const out: PelletSample[] = new Array(frames);
  for (let k = 0; k < frames; k++) {
    const off = k * n + pelletId;
    out[k] = { t: result.histTimes[k], temp: result.histTemp[off], heat: result.histHeat[off] };
  }
  return out;
}

/** 无头快进：种子数据/重跑用 */
export function runHeadless(input: EngineInput): RoastResult {
  return new RoastEngine(input).runToEnd();
}
