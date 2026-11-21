// 测试批次 + 三位师傅 + 焙火记录种子数据，全部由仿真引擎真实跑出结果
import type {
  TeaBatch, BasketConfig, MasterProfile, RoastRecord, RoastResult,
  RoastSession, RoastNode, FireGrade,
} from '../types';
import { RoastEngine, type EngineInput } from '../sim/engine';
import { hashSeed } from '../sim/rng';
import { repo, uid, bedDims, bulkSeed } from './repo';

let nodeSeq = 0;
function node(tSec: number, kind: RoastNode['kind'], extra: Partial<RoastNode> = {}): RoastNode {
  return { id: `n${nodeSeq++}`, tSec, kind, ...extra };
}

function roastSession(
  startOffsetSec: number,
  durationSec: number,
  firePower: number,
  ashCm: number,
  turnHours: number[],
  extra: RoastNode[] = [],
): RoastSession {
  const nodes: RoastNode[] = [
    node(0, 'start', { firePower, ashThicknessCm: ashCm }),
    ...turnHours.map((h) => node(h * 3600, 'turn', { label: `翻焙 ${h}h` })),
    ...extra,
    node(durationSec, 'end'),
  ];
  nodes.sort((a, b) => a.tSec - b.tSec);
  return {
    id: uid('ses'), phase: 'roast', startOffsetSec: startOffsetSec,
    durationSec, firePower, ashThicknessCm: ashCm, nodes,
  };
}

function coolSession(startOffsetSec: number, durationSec: number): RoastSession {
  return {
    id: uid('ses'), phase: 'cool', startOffsetSec, durationSec,
    firePower: 0, ashThicknessCm: 0,
    nodes: [node(0, 'start'), node(durationSec, 'end')],
  };
}

export function seedBatches(): TeaBatch[] {
  const mk = (
    id: string, name: string, mountain: string, craft: TeaBatch['craft'],
    moisture: number, tightness: number, loadKg: number, diameter = 68,
  ): TeaBatch => {
    const partial = { teaLoadKg: loadKg, basketDiameterCm: diameter, tightness };
    // 与 repo.computeBatchThickness 同公式，避免循环依赖
    const bulk = 0.30 + tightness * 0.08;
    const volL = loadKg / bulk;
    const area = Math.PI * (diameter / 2) ** 2;
    const thickness = (volL * 1000) / area;
    return {
      id, name, variety: '铁观音', mountain, craft,
      moisturePct: moisture, tightness,
      basketDiameterCm: diameter, teaLoadKg: loadKg,
      layerThicknessCm: thickness, pelletCount: 5000,
      createdAt: Date.now(),
      note: `测试批次 · ${mountain}`,
    };
  };
  return [
    mk('batch-001', '2026秋 感德铁观音一号', '感德镇高山', '清香型', 6.8, 0.82, 4.0),
    mk('batch-002', '2026秋 祥华铁观音二号', '祥华乡山地', '韵香型', 7.4, 0.66, 4.5),
    mk('batch-003', '2026秋 西坪铁观音三号', '西坪镇内山', '浓香型', 8.1, 0.52, 5.0, 72),
  ];
}

export function seedBaskets(): BasketConfig[] {
  return [
    {
      id: 'basket-001', name: '一号传统焙窟', pitDiameterCm: 72, pitDepthCm: 46,
      basketDiameterCm: 68, basketHeightCm: 34, gapToCharcoalCm: 26,
      charcoal: '荔枝木炭', charcoalKg: 6.5, ashThicknessCm: 3,
      note: '老师傅常用窟，火势稳',
    },
    {
      id: 'basket-002', name: '二号大焙窟', pitDiameterCm: 78, pitDepthCm: 50,
      basketDiameterCm: 72, basketHeightCm: 36, gapToCharcoalCm: 24,
      charcoal: '龙眼木炭', charcoalKg: 8, ashThicknessCm: 2.5,
      note: '大笼，吃炭量大',
    },
  ];
}

export function seedMasters(): MasterProfile[] {
  return [
    {
      id: 'master-001', name: '陈德炉', title: '高级评茶师/炭焙非遗传承人', years: 38,
      specialty: '中火韵香铁观音，曲线以稳见长',
      typicalGrade: '中火',
      signatureCurve: roastSession(0, 6 * 3600, 0.62, 3.0, [1.5, 3, 4.5], [
        node(2.2 * 3600, 'pressAsh', { ashThicknessCm: 3.4, label: '轻压灰稳火', source: 'handwritten' }),
      ]),
      note: '主张"慢火细炖"，每 90 分钟一翻',
    },
    {
      id: 'master-002', name: '林火旺', title: '炭焙技师', years: 16,
      specialty: '轻火清香，起炉旺、收尾快',
      typicalGrade: '轻火',
      signatureCurve: roastSession(0, 4 * 3600, 0.58, 2.6, [1.2, 2.4], []),
      note: '手劲大，翻焙利落，小火短焙保清香',
    },
    {
      id: 'master-003', name: '吴阿炭', title: '年轻焙茶工', years: 4,
      specialty: '学艺中，照陈师傅曲线焙',
      typicalGrade: '中火',
      signatureCurve: roastSession(0, 6 * 3600, 0.62, 3.0, [1.5, 3, 4.5], []),
      note: '本次起炭过旺，中途压灰救回',
    },
  ];
}

/** 四条焙火记录（含压灰救回 + 复焙） */
export function seedRecords(): { records: RoastRecord[]; engineInputs: EngineInput[] } {
  const H = 3600;
  // R1 陈师傅：标准中火，初焙 + 摊凉 3 天 + 复焙 2 小时
  const r1Sessions = [
    roastSession(0, 6 * H, 0.62, 3.0, [1.5, 3, 4.5], [
      node(2.2 * H, 'pressAsh', { ashThicknessCm: 3.4, label: '轻压灰稳火', source: 'handwritten' }),
    ]),
    coolSession(6 * H, 3 * 86400),
    roastSession(6 * H + 3 * 86400, 2 * H, 0.5, 3.6, [1], []),
  ];
  // R2 林师傅：轻火快焙（小火短焙，保清香）
  const r2Sessions = [roastSession(0, 4 * H, 0.58, 2.6, [1.2, 2.4], [])];
  // R3 吴阿炭：起炭偏猛（0.78、薄灰 1.2cm），75 分钟发现上层烫手，压厚灰并撤火救回
  const r3Sessions = [
    roastSession(0, 6 * H, 0.78, 1.2, [1.25, 3, 4.5], [
      node(1.25 * H, 'pressAsh', {
        ashThicknessCm: 4.6, firePower: 0.5,
        label: '压厚灰+撤火救场', source: 'handwritten',
      }),
      node(3 * H, 'pressAsh', { ashThicknessCm: 3.8, label: '二次压灰稳火' }),
    ]),
  ];
  // R4 同批三号：足火慢炖，验证厚床底层风险（翻焙偏晚，底层有焦损）
  const r4Sessions = [
    roastSession(0, 7.5 * H, 0.66, 2.6, [2.5, 5], [
      node(2.5 * H, 'turn', { label: '翻焙偏晚', source: 'handwritten' }),
    ]),
  ];

  const mk = (
    id: string, code: string, batchId: string, basketId: string, masterId: string,
    target: FireGrade, sessions: RoastSession[], follow?: string, note?: string,
  ): RoastRecord => {
    const total = Math.max(...sessions.map((s) => s.startOffsetSec + s.durationSec));
    return {
      id, code, batchId, basketId, masterId, targetGrade: target,
      sessions, pelletCount: 5000, totalDurationSec: total,
      followMasterId: follow, handwrittenNote: note, createdAt: Date.now(),
    };
  };

  const records = [
    mk('record-001', 'TB-2026-R001', 'batch-001', 'basket-001', 'master-001', '中火', r1Sessions, undefined,
      '午时起炉，炭面透红不冒焰；二点半轻压灰；三日后复焙两时辰收口。'),
    mk('record-002', 'TB-2026-R002', 'batch-001', 'basket-001', 'master-002', '轻火', r2Sessions),
    mk('record-003', 'TB-2026-R003', 'batch-002', 'basket-002', 'master-003', '中火', r3Sessions, 'master-001',
      '起炭过旺，七点五刻笼壁烫手，急压厚灰并撤去两块生炭；后半程转稳。'),
    mk('record-004', 'TB-2026-R004', 'batch-003', 'basket-002', 'master-001', '足火', r4Sessions, undefined,
      '厚床慢炖，头翻偏晚半个时辰，底层略有焦粒。'),
  ];

  // 引擎输入在拿到批次/焙笼后由 buildSeedResults 补全
  return { records, engineInputs: [] };
}

/** 跑全部仿真并产出 RoastResult（含完整逐颗粒历程） */
export async function buildAndStoreSeeds(): Promise<{ recordCount: number }> {
  const batches = seedBatches();
  const baskets = seedBaskets();
  const masters = seedMasters();
  const { records } = seedRecords();
  const results: RoastResult[] = [];

  for (const rec of records) {
    const batch = batches.find((b) => b.id === rec.batchId)!;
    const basket = baskets.find((b) => b.id === rec.basketId)!;
    const { radiusM, thicknessM } = bedDims(batch, basket);
    const input: EngineInput = {
      recordId: rec.id,
      pelletCount: rec.pelletCount,
      bedRadiusM: radiusM,
      bedThicknessM: thicknessM,
      sessions: rec.sessions,
      totalDurationSec: rec.totalDurationSec,
      targetGrade: rec.targetGrade,
      initialMoisturePct: batch.moisturePct,
      seed: hashSeed(rec.id),
    };
    const engine = new RoastEngine(input);
    const result = engine.runToEnd();
    rec.resultId = result.id;
    rec.summary = result.summary;
    results.push(result);
  }

  await bulkSeed({ batches, baskets, masters, records, results });
  return { recordCount: records.length };
}
