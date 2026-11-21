// 确定性随机数（mulberry32）+ 分布工具 —— 仿真可复现，同一记录每次重跑结果一致

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** 近似正态（Box-Muller），裁剪到 ±3σ */
  gaussian(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-9);
    const v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + sd * Math.max(-3, Math.min(3, z));
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}

/** 字符串 -> 32 位种子（FNV-1a） */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Fisher–Yates 洗牌，返回 perm：perm[旧下标]=新下标 */
export function shuffledPerm(n: number, rng: Rng): Uint32Array {
  const perm = new Uint32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  return perm;
}

/** 校验重排表是一个不丢不重的排列 */
export function assertPermutation(perm: Uint32Array): void {
  const seen = new Uint8Array(perm.length);
  for (let i = 0; i < perm.length; i++) {
    const v = perm[i];
    if (v >= perm.length || seen[v]) {
      throw new Error(`翻焙排列在第 ${i} 颗处非法（重复或越界），颗粒 id=${v}`);
    }
    seen[v] = 1;
  }
}
