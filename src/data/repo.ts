// 数据仓库：IDB 读写 + 领域辅助
import { idbAll, idbPut, idbDelete, idbGet, idbBulkPut } from '../db/idb';
import type { TeaBatch, BasketConfig, RoastRecord, MasterProfile, RoastResult, FireGrade } from '../types';
import { calcLayerThicknessCm } from '../sim/geometry';

export const repo = {
  batches: {
    all: () => idbAll('batches') as Promise<TeaBatch[]>,
    get: (id: string) => idbGet('batches', id) as Promise<TeaBatch | undefined>,
    save: (b: TeaBatch) => idbPut('batches', b),
    remove: (id: string) => idbDelete('batches', id),
  },
  baskets: {
    all: () => idbAll('baskets') as Promise<BasketConfig[]>,
    get: (id: string) => idbGet('baskets', id) as Promise<BasketConfig | undefined>,
    save: (b: BasketConfig) => idbPut('baskets', b),
    remove: (id: string) => idbDelete('baskets', id),
  },
  records: {
    all: () => idbAll('records') as Promise<RoastRecord[]>,
    get: (id: string) => idbGet('records', id) as Promise<RoastRecord | undefined>,
    save: (r: RoastRecord) => idbPut('records', r),
    remove: async (id: string) => {
      const r = await idbGet('records', id) as RoastRecord | undefined;
      if (r?.resultId) await idbDelete('results', r.resultId);
      await idbDelete('records', id);
    },
  },
  masters: {
    all: () => idbAll('masters') as Promise<MasterProfile[]>,
    get: (id: string) => idbGet('masters', id) as Promise<MasterProfile | undefined>,
    save: (m: MasterProfile) => idbPut('masters', m),
    remove: (id: string) => idbDelete('masters', id),
  },
  results: {
    all: () => idbAll('results') as Promise<RoastResult[]>,
    get: (id: string) => idbGet('results', id) as Promise<RoastResult | undefined>,
    save: (r: RoastResult) => idbPut('results', r),
  },
};

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 毛茶登记时自动计算铺茶厚度 */
export function computeBatchThickness(b: Pick<TeaBatch, 'teaLoadKg' | 'basketDiameterCm' | 'tightness'>): number {
  return calcLayerThicknessCm(b.teaLoadKg, b.basketDiameterCm, b.tightness);
}

/** 由批次+焙笼推出仿真几何输入 */
export function bedDims(batch: TeaBatch, basket: BasketConfig): { radiusM: number; thicknessM: number } {
  return {
    radiusM: basket.basketDiameterCm / 200,
    thicknessM: batch.layerThicknessCm / 100,
  };
}

export const GRADE_ORDER: FireGrade[] = ['轻火', '中火', '足火'];

export function gradeDeltaText(delta: number): string {
  if (Math.abs(delta) < 0.35) return '档位基本吻合';
  const dir = delta < 0 ? '偏嫩（火不足）' : '偏老（火过头）';
  const n = Math.abs(delta) >= 1 ? `${Math.round(Math.abs(delta))}档` : '半档';
  return `${dir}约${n}`;
}

export async function bulkSeed(items: {
  batches?: TeaBatch[]; baskets?: BasketConfig[]; records?: RoastRecord[];
  masters?: MasterProfile[]; results?: RoastResult[];
}): Promise<void> {
  if (items.batches) await idbBulkPut('batches', items.batches);
  if (items.baskets) await idbBulkPut('baskets', items.baskets);
  if (items.masters) await idbBulkPut('masters', items.masters);
  if (items.records) await idbBulkPut('records', items.records);
  if (items.results) await idbBulkPut('results', items.results);
}
