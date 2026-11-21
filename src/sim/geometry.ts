// 焙笼茶床几何：颗粒堆成中间凹、四周高的环形床体
import { Rng } from './rng';

export interface BedGeometry {
  count: number;
  radius: number;       // 茶床半径（米）
  baseY: number;        // 床底高度（米）
  thickness: number;    // 铺茶厚度（米）
  rimHeight: number;    // 四周隆起高度（米）
  centerDip: number;    // 中心下凹深度（米）
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  sizes: Float32Array;
  shapes: Float32Array;
  layer: Uint8Array;    // 0 上 / 1 中 / 2 下（初始层）
  normH: Float32Array;  // 床内归一化高度 0..1（用于温度梯度）
  normR: Float32Array;  // 归一化半径 0..1
}

/**
 * 铺茶厚度（cm）= 投茶量体积 / 焙笼截面积，再乘松装系数
 * 铁观音干茶松装密度约 0.32 kg/L
 */
export function calcLayerThicknessCm(teaLoadKg: number, basketDiameterCm: number, tightness: number): number {
  const bulkDensityKgPerL = 0.30 + tightness * 0.08; // 紧结度高 -> 密度略大
  const volumeL = teaLoadKg / bulkDensityKgPerL;
  const areaCm2 = Math.PI * (basketDiameterCm / 2) ** 2;
  return (volumeL * 1000) / areaCm2;
}

/**
 * 生成环形凹面茶床。
 * 策略：在圆柱体内按面积均匀撒点，顶面高度 = base + thickness + rim*r^2 - dip*(1-r^2)^2，
 * 再让每颗粒在床底与顶面之间按紧密堆积随机落位。
 */
export function buildBed(
  count: number,
  radiusM: number,
  thicknessM: number,
  rng: Rng,
): BedGeometry {
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const pz = new Float32Array(count);
  const sizes = new Float32Array(count);
  const shapes = new Float32Array(count);
  const layer = new Uint8Array(count);
  const normH = new Float32Array(count);
  const normR = new Float32Array(count);

  const baseY = 0;
  const rimHeight = thicknessM * 0.35;
  const centerDip = thicknessM * 0.28;
  const pelletR = estimatePelletRadius(count, radiusM, thicknessM);

  // 顶面轮廓函数
  const topY = (nr: number) =>
    baseY + thicknessM + rimHeight * nr * nr - centerDip * (1 - nr * nr) ** 2;

  for (let i = 0; i < count; i++) {
    // 面积均匀：r = R*sqrt(u)
    const nr = Math.sqrt(rng.next()) * 0.985;
    const ang = rng.next() * Math.PI * 2;
    const r = nr * radiusM;
    const top = topY(nr);
    // 垂直方向带一点堆积抖动的均匀分布
    const h = rng.next();
    const y = baseY + pelletR + h * Math.max(1e-4, top - baseY - 2 * pelletR);

    px[i] = Math.cos(ang) * r;
    py[i] = y;
    pz[i] = Math.sin(ang) * r;
    sizes[i] = pelletR * rng.range(0.75, 1.3);
    shapes[i] = rng.next() * 1000;
    normR[i] = nr;
    const nh = (y - baseY) / Math.max(1e-4, top - baseY);
    normH[i] = nh;
    layer[i] = nh < 0.34 ? 2 : nh < 0.67 ? 1 : 0;
  }

  return {
    count, radius: radiusM, baseY, thickness: thicknessM,
    rimHeight, centerDip, px, py, pz, sizes, shapes, layer, normH, normR,
  };
}

/** 由体积与填充率反推单颗粒等效半径（米） */
function estimatePelletRadius(count: number, radius: number, thickness: number): number {
  const packing = 0.62; // 球体随机密堆填充率
  const bedVol = Math.PI * radius * radius * thickness;
  const perVol = (bedVol * packing) / count;
  return Math.cbrt((perVol * 3) / (4 * Math.PI));
}

/** 顶面轮廓（供渲染器画床面/剖面） */
export function bedTopY(bed: BedGeometry, nr: number): number {
  return (
    bed.baseY +
    bed.thickness +
    bed.rimHeight * nr * nr -
    bed.centerDip * (1 - nr * nr) ** 2
  );
}
