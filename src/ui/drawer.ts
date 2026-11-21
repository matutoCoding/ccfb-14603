// 颗粒追溯抽屉：逐颗粒温度/火功历程 + 翻焙节点 + 层位变迁
import { h, clear, fmtTime } from './dom';
import { pelletHistoryChart } from './charts';
import { getPelletHistory } from '../sim/engine';
import type { RoastResult } from '../types';

export interface DrawerData {
  pelletId: number;
  result?: RoastResult;          // 静态结果（优先，含完整历程）
  liveSamples?: { t: number; temp: number; heat: number }[]; // 实时模式
  liveTurns?: { atSec: number }[];
  currentHeat: number;
  currentTemp: number;
  finalScorch?: number;
  finalLayer?: number;
  maxTemp?: number;
}

const LAYER_NAME = ['上层', '中层', '下层'];

export function openPelletDrawer(data: DrawerData): () => void {
  const mask = h('div', { class: 'drawer-mask' });
  const drawer = h('div', { class: 'drawer' });
  const close = () => { mask.remove(); drawer.remove(); };
  mask.addEventListener('click', close);

  const samples = data.result
    ? getPelletHistory(data.result, data.pelletId)
    : data.liveSamples ?? [];
  const turns = data.result
    ? data.result.turns.map((t) => ({ atSec: t.atSec }))
    : data.liveTurns ?? [];

  const chart = samples.length > 1 ? pelletHistoryChart(samples) : h('div', { class: 'muted' }, '历程采样中…');

  // 翻焙时该颗粒的层位跳变（由相邻采样帧的位置所在层近似，静态结果可精确算）
  const layerLog = buildLayerLog(data);

  clear(drawer);
  drawer.append(
    h('button', { class: 'small ghost close', onclick: close }, '关闭'),
    h('h3', {}, `颗粒 #${String(data.pelletId).padStart(4, '0')}`),
    h('p', { class: 'sub' }, '每颗茶从进笼到出焙的完整受热档案；翻焙只重排槽位，颗粒身份不变、不丢不重。'),
    h('div', { class: 'kv' },
      h('span', { class: 'k' }, '当前温度'), h('span', { class: 'mono' }, data.currentTemp.toFixed(1) + ' ℃'),
      h('span', { class: 'k' }, '累计火功'), h('span', { class: 'mono' }, data.currentHeat.toFixed(3)),
      data.maxTemp != null ? h('span', { class: 'k' }, '历程最高温') : h('span'),
      data.maxTemp != null ? h('span', { class: 'mono' }, data.maxTemp.toFixed(1) + ' ℃') : h('span'),
      data.finalScorch != null ? h('span', { class: 'k' }, '焦损程度') : h('span'),
      data.finalScorch != null ? h('span', { class: data.finalScorch > 0.35 ? 'bad-text' : '' },
        (data.finalScorch * 100).toFixed(1) + (data.finalScorch > 0.35 ? '（起焦斑）' : '')) : h('span'),
      data.finalLayer != null ? h('span', { class: 'k' }, '出焙层位') : h('span'),
      data.finalLayer != null ? h('span', {}, LAYER_NAME[data.finalLayer]) : h('span'),
    ),
    h('h2', {}, '温度 / 火功历程'),
    chart,
    h('h2', {}, `翻焙节点（${turns.length} 次）`),
    turns.length === 0
      ? h('div', { class: 'muted' }, '尚未翻焙')
      : h('div', {}, ...turns.map((t, i) =>
        h('div', { style: 'margin:4px 0' },
          h('span', { class: 'pill-node' }, `第${i + 1}次`),
          `进笼后 ${fmtTime(t.atSec)} 上下层打乱重排`),
      )),
    h('h2', {}, '层位变迁'),
    layerLog.length === 0
      ? h('div', { class: 'muted' }, '出焙后可查看完整层位变迁')
      : h('div', {}, ...layerLog.map((l) =>
        h('div', { style: 'margin:3px 0' },
          h('span', { class: 'pill-node' }, fmtTime(l.t)),
          `${LAYER_NAME[l.layer]}（槽位 ${l.slot}）`),
      )),
  );

  document.body.append(mask, drawer);
  return close;
}

function buildLayerLog(data: DrawerData): { t: number; layer: number; slot: number }[] {
  const r = data.result;
  if (!r) return [];
  const n = r.pelletCount;
  const slot = new Uint32Array(n);
  for (let id = 0; id < n; id++) slot[id] = id;
  const log: { t: number; layer: number; slot: number }[] = [{
    t: 0, layer: r.slotLayer[slot[data.pelletId]], slot: slot[data.pelletId],
  }];
  for (const turn of r.turns) {
    for (let id = 0; id < n; id++) slot[id] = turn.perm[slot[id]];
    log.push({ t: turn.atSec, layer: r.slotLayer[slot[data.pelletId]], slot: slot[data.pelletId] });
  }
  return log;
}
