// 仿真构建工厂：记录 -> 引擎输入 / 引擎 / 无头重跑
import type { RoastRecord, TeaBatch, BasketConfig, RoastResult } from '../types';
import { RoastEngine, type EngineInput } from '../sim/engine';
import { hashSeed } from '../sim/rng';
import { bedDims, repo } from './repo';

export function buildEngineInput(
  rec: RoastRecord,
  batch: TeaBatch,
  basket: BasketConfig,
): EngineInput {
  const { radiusM, thicknessM } = bedDims(batch, basket);
  return {
    recordId: rec.id,
    pelletCount: rec.pelletCount,
    bedRadiusM: radiusM,
    bedThicknessM: thicknessM,
    sessions: rec.sessions,
    totalDurationSec: rec.totalDurationSec,
    targetGrade: rec.targetGrade,
    initialMoisturePct: batch.moisturePct,
    seed: hashSeed(rec.id + ':v2'),
  };
}

export function createEngine(rec: RoastRecord, batch: TeaBatch, basket: BasketConfig): RoastEngine {
  return new RoastEngine(buildEngineInput(rec, batch, basket));
}

/** 无头重跑并持久化结果（编辑曲线后调用） */
export async function rerunHeadless(
  rec: RoastRecord,
  batch: TeaBatch,
  basket: BasketConfig,
): Promise<RoastResult> {
  const engine = createEngine(rec, batch, basket);
  const result = engine.runToEnd();
  rec.summary = result.summary;
  rec.resultId = result.id;
  await repo.results.save(result);
  await repo.records.save(rec);
  return result;
}
