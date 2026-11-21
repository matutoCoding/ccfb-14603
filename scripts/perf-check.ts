// 渲染热路径性能测试：模拟每帧 5000 颗粒的实例缓冲数据组装 + 翻焙槽位重排
import { RoastEngine } from '../src/sim/engine';
import { hashSeed } from '../src/sim/rng';
import { seedBatches, seedBaskets, seedRecords } from '../src/data/seed';
import { bedDims } from '../src/data/repo';

const batches = seedBatches();
const baskets = seedBaskets();
const { records } = seedRecords();
const rec = records[0];
const batch = batches.find((b) => b.id === rec.batchId)!;
const basket = baskets.find((b) => b.id === rec.basketId)!;
const { radiusM, thicknessM } = bedDims(batch, basket);

const engine = new RoastEngine({
  recordId: rec.id, pelletCount: 5000, bedRadiusM: radiusM, bedThicknessM: thicknessM,
  sessions: rec.sessions, totalDurationSec: rec.totalDurationSec,
  targetGrade: rec.targetGrade, initialMoisturePct: batch.moisturePct, seed: hashSeed(rec.id),
});

const n = 5000;
const off = new Float32Array(n * 3);
const state = new Float32Array(n * 2);
const size = new Float32Array(n);
const shape = new Float32Array(n);
const pick = new Float32Array(n);
const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);

// 先推进到中段，制造翻焙
engine.advance(2 * 3600);

// 模拟 600 个 rAF 帧（约 10 秒），每帧都走 scene.drawPellets 的 CPU 组装路径
const FRAMES = 600;
const t0 = performance.now();
for (let f = 0; f < FRAMES; f++) {
  engine.advance(16 * 16); // 16x 倍速下每帧推进
  engine.fillPositions(x, y, z);
  for (let id = 0; id < n; id++) {
    off[id * 3] = x[id]; off[id * 3 + 1] = y[id]; off[id * 3 + 2] = z[id];
    size[id] = engine.bed.sizes[id];
    shape[id] = engine.bed.shapes[id];
    state[id * 2] = engine.heat[id];
    state[id * 2 + 1] = engine.scorch[id];
    pick[id] = id + 1;
  }
}
const ms = performance.now() - t0;
console.log(`5000 颗粒 × ${FRAMES} 帧 CPU 组装总耗时 ${ms.toFixed(1)}ms，单帧均值 ${(ms / FRAMES).toFixed(3)}ms`);
console.log(`折算可支撑 ${Math.floor(1000 / (ms / FRAMES))} FPS（仅 CPU 侧，不含 GPU 绘制）`);

// 翻焙重排本身的成本与合法性
const t1 = performance.now();
for (let i = 0; i < 20; i++) {
  engine.advance(300);
}
// 验证所有翻焙排列不丢不重
for (const turn of engine.turns) {
  const seen = new Uint8Array(n);
  for (let k = 0; k < turn.perm.length; k++) {
    if (seen[turn.perm[k]]) throw new Error('翻焙排列重复');
    seen[turn.perm[k]] = 1;
  }
}
console.log(`20 次推进（含翻焙事件）耗时 ${(performance.now() - t1).toFixed(1)}ms，累计翻焙 ${engine.turns.length} 次，排列全部合法`);

// 单颗粒历史查询成本（点击追溯）
const result = engine.runToEnd();
const t2 = performance.now();
const hist: { t: number; temp: number; heat: number }[] = [];
const frames = result.histTimes.length;
for (let k = 0; k < frames; k++) {
  hist.push({ t: result.histTimes[k], temp: result.histTemp[k * n + 777], heat: result.histHeat[k * n + 777] });
}
console.log(`颗粒#777 追溯 ${hist.length} 帧耗时 ${(performance.now() - t2).toFixed(2)}ms`);

if (ms / FRAMES > 4) throw new Error('单帧 CPU 组装超过 4ms，5000 颗粒实时性不达标');
console.log('\n渲染热路径性能达标 ✓');
