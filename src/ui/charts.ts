// 零依赖 Canvas 图表：温度曲线（带翻焙/压灰节点）、火功分布直方图、颗粒历程
import { h } from './dom';
import { heatRampJS } from '../webgl/shaders';

export interface ChartNode {
  t: number;
  label: string;
  kind: string;
}

function setup(cv: HTMLCanvasElement, hCss = 220): CanvasRenderingContext2D {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.style.height = hCss + 'px';
  const w = cv.clientWidth || 600;
  cv.width = w * dpr;
  cv.height = hCss * dpr;
  const ctx = cv.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return ctx;
}

function cssColor(rgb: [number, number, number], a = 1): string {
  return `rgba(${rgb.map((v) => Math.round(v * 255)).join(',')},${a})`;
}

/** 温度曲线：可画多条序列 + 节点竖线，可选点击节点回调（时间轴编辑用） */
export function temperatureChart(opts: {
  series: { name: string; color: string; points: { t: number; v: number }[] }[];
  nodes?: ChartNode[];
  height?: number;
  yLabel?: string;
  onSeek?: (t: number) => void;
  markerT?: number;
}): HTMLCanvasElement {
  const cv = h('canvas', { class: 'chart' }) as HTMLCanvasElement;
  requestAnimationFrame(() => {
    const ctx = setup(cv, opts.height ?? 220);
    const W = cv.clientWidth, H = opts.height ?? 220;
    const padL = 46, padR = 14, padT = 14, padB = 26;
    const all = opts.series.flatMap((s) => s.points);
    if (!all.length) return;
    const tMax = Math.max(...all.map((p) => p.t), 1);
    const vMax = Math.max(...all.map((p) => p.v), 100) * 1.08;
    const X = (t: number) => padL + (t / tMax) * (W - padL - padR);
    const Y = (v: number) => padT + (1 - v / vMax) * (H - padT - padB);

    ctx.strokeStyle = '#3a3126'; ctx.fillStyle = '#a89880'; ctx.lineWidth = 1;
    ctx.font = '11px sans-serif';
    for (let g = 0; g <= 4; g++) {
      const v = (vMax / 4) * g;
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillText(Math.round(v) + '', 6, y + 4);
    }
    // x 轴时间刻度
    for (let g = 0; g <= 6; g++) {
      const t = (tMax / 6) * g;
      const x = X(t);
      const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60);
      ctx.fillText(`${hh}:${String(mm).padStart(2, '0')}`, x - 14, H - 8);
    }

    // 节点竖线
    for (const n of opts.nodes ?? []) {
      const x = X(n.t);
      ctx.strokeStyle = n.kind === 'pressAsh' ? '#6f95b8' : '#c8853c';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = n.kind === 'pressAsh' ? '#6f95b8' : '#c8853c';
      ctx.fillText(n.label, x + 3, padT + 11);
    }

    for (const s of opts.series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2;
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = X(p.t), y = Y(p.v);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    // 图例
    opts.series.forEach((s, i) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(padL + i * 130, 2, 10, 3);
      ctx.fillStyle = '#a89880';
      ctx.fillText(s.name, padL + i * 130 + 14, 6);
    });
    if (opts.markerT != null) {
      const x = X(opts.markerT);
      ctx.strokeStyle = '#e8ddc9'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
    }
    if (opts.onSeek) {
      cv.style.cursor = 'pointer';
      cv.onclick = (e) => {
        const rect = cv.getBoundingClientRect();
        const t = ((e.clientX - rect.left - padL) / (W - padL - padR)) * tMax;
        if (t >= 0) opts.onSeek!(Math.max(0, Math.min(tMax, t)));
      };
    }
  });
  return cv;
}

/** 火功分布直方图（颜色按火功色带着色） */
export function histogramChart(values: Float32Array, bins = 24, height = 200): HTMLCanvasElement {
  const cv = h('canvas', { class: 'chart' }) as HTMLCanvasElement;
  requestAnimationFrame(() => {
    const ctx = setup(cv, height);
    const W = cv.clientWidth, H = height;
    const padL = 42, padR = 12, padT = 12, padB = 24;
    const vMax = Math.max(...Array.from(values), 0.1) * 1.05;
    const counts = new Array(bins).fill(0);
    for (const v of values) counts[Math.min(bins - 1, Math.floor((v / vMax) * bins))]++;
    const cMax = Math.max(...counts, 1);
    const bw = (W - padL - padR) / bins;
    ctx.font = '11px sans-serif';
    for (let g = 0; g <= 4; g++) {
      const c = (cMax / 4) * g;
      const y = padT + (1 - g / 4) * (H - padT - padB);
      ctx.strokeStyle = '#3a3126';
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = '#a89880';
      ctx.fillText(String(Math.round(c)), 8, y + 4);
    }
    counts.forEach((c, i) => {
      const heat = ((i + 0.5) / bins) * vMax;
      const [r, g, b] = heatRampJS(heat);
      ctx.fillStyle = cssColor([r, g, b]);
      const bh = (c / cMax) * (H - padT - padB);
      ctx.fillRect(padL + i * bw + 1, H - padB - bh, bw - 2, bh);
      if (i % 4 === 0) {
        ctx.fillStyle = '#a89880';
        ctx.fillText(heat.toFixed(1), padL + i * bw - 6, H - 8);
      }
    });
    ctx.fillStyle = '#a89880';
    ctx.fillText('颗粒数', 4, 10);
  });
  return cv;
}

/** 单颗粒温度 + 火功双轴历程 */
export function pelletHistoryChart(samples: { t: number; temp: number; heat: number }[], height = 210): HTMLCanvasElement {
  return temperatureChart({
    height,
    series: [
      { name: '颗粒温度 ℃', color: '#e0a860', points: samples.map((s) => ({ t: s.t, v: s.temp })) },
      { name: '累计火功 ×100', color: '#7d9b58', points: samples.map((s) => ({ t: s.t, v: s.heat * 100 })) },
    ],
  });
}

/** 火功色带图例 */
export function heatLegend(): HTMLElement {
  const cv = h('canvas', { width: '180', height: '14' }) as HTMLCanvasElement;
  cv.style.width = '180px';
  const ctx = cv.getContext('2d')!;
  for (let x = 0; x < 180; x++) {
    const heat = (x / 180) * 1.8;
    const [r, g, b] = heatRampJS(heat);
    ctx.fillStyle = cssColor([r, g, b]);
    ctx.fillRect(x, 0, 1, 14);
  }
  return cv;
}
