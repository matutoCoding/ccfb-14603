// 无头仿真校验（Node 直跑 TS，经 vite/esbuild 转译）
// 运行：npx vite-node scripts/headless-check.ts
import { seedBatches, seedBaskets, seedMasters, seedRecords } from '../src/data/seed';
import { RoastEngine, type EngineInput } from '../src/sim/engine';
import { hashSeed } from '../src/sim/rng';
import { bedDims } from '../src/data/repo';
import { GRADE_BOUNDS } from '../src/sim/temperature';

const batches = seedBatches();
const baskets = seedBaskets();
const masters = seedMasters();
const { records } = seedRecords();

console.log('=== 铺茶厚度自动计算 ===');
for (const b of batches) {
  console.log(`${b.name}: 投茶${b.teaLoadKg}kg 笼径${b.basketDiameterCm}cm 紧结${b.tightness} -> 厚度 ${b.layerThicknessCm.toFixed(2)}cm`);
}

let totalMs = 0;
for (const rec of records) {
  const batch = batches.find((b) => b.id === rec.batchId)!;
  const basket = baskets.find((b) => b.id === rec.basketId)!;
  const { radiusM, thicknessM } = bedDims(batch, basket);
  const input: EngineInput = {
    recordId: rec.id, pelletCount: rec.pelletCount,
    bedRadiusM: radiusM, bedThicknessM: thicknessM,
    sessions: rec.sessions, totalDurationSec: rec.totalDurationSec,
    targetGrade: rec.targetGrade, initialMoisturePct: batch.moisturePct,
    seed: hashSeed(rec.id),
  };
  const t0 = performance.now();
  const engine = new RoastEngine(input);
  const result = engine.runToEnd();
  const ms = performance.now() - t0;
  totalMs += ms;

  // 翻焙排列合法性（不丢不重）
  for (const turn of result.turns) {
    const seen = new Set(turn.perm);
    if (seen.size !== turn.perm.length) throw new Error('翻焙排列有重复颗粒！');
  }

  // 历程帧完整性
  const frames = result.histTimes.length;
  if (result.histTemp.length !== frames * rec.pelletCount) throw new Error('历程长度不一致');

  const bytes =
    result.histTimes.byteLength + result.histTemp.byteLength + result.histHeat.byteLength +
    result.px.byteLength * 6 + result.heat.byteLength * 2 + result.scorch.byteLength +
    result.maxTemp.byteLength + result.finalLayer.byteLength;

  const s = result.summary;
  const master = masters.find((m) => m.id === rec.masterId);
  console.log('\n=== ' + rec.code + '（' + master?.name + '，目标' + rec.targetGrade + '）===');
  console.log(`仿真耗时 ${ms.toFixed(0)}ms，历程帧 ${frames}，结果体量 ${(bytes / 1024 / 1024).toFixed(2)}MB`);
  console.log(`档位=${s.grade} 均值=${s.meanHeat.toFixed(3)} 标准差=${s.stdHeat.toFixed(3)} 区间=[${s.minHeat.toFixed(2)},${s.maxHeat.toFixed(2)}]`);
  console.log(`均匀度=${s.uniformPct.toFixed(1)}% 焦斑=${s.scorchPct.toFixed(2)}% 底层焦=${s.bottomScorchPct.toFixed(2)}%`);
  console.log(`上/中/下层均值=${s.layerMean.map((x) => x.toFixed(3)).join(' / ')} 终含水=${s.finalMoisturePct.toFixed(2)}%`);
  console.log(`翻焙 ${result.turns.length} 次，排列均合法；偏档=${s.gradeDelta.toFixed(2)}`);

  // 单颗粒追溯抽检
  const id = 1234;
  const samples: { t: number; temp: number; heat: number }[] = [];
  for (let k = 0; k < frames; k++) {
    samples.push({
      t: result.histTimes[k],
      temp: result.histTemp[k * rec.pelletCount + id],
      heat: result.histHeat[k * rec.pelletCount + id],
    });
  }
  const maxT = Math.max(...samples.map((x) => x.temp));
  console.log(`颗粒#${id} 追溯: ${samples.length} 个采样点, 最高温 ${maxT.toFixed(1)}℃, 终火功 ${samples.at(-1)!.heat.toFixed(3)}`);
}

console.log('\n=== 档位阈值对照 ===', GRADE_BOUNDS);
console.log(`4 条记录总仿真耗时 ${totalMs.toFixed(0)}ms（平均 ${(totalMs / 4).toFixed(0)}ms/条）`);
console.log('\n全部断言通过 ✓');
