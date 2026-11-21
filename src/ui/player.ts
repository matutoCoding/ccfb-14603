// 三维焙火播放器：实时引擎或静态结果共用，含播放控制/剖面/热力开关/颗粒拾取
import { h } from './dom';
import { RoastScene, type PickedInfo } from '../webgl/scene';
import type { SceneAdapter, SceneFrame } from '../webgl/adapter';
import type { BasketConfig } from '../types';
import { heatLegend } from './charts';

export interface PlayerHandle {
  viewport: HTMLElement;
  scene: () => RoastScene | null;
  setFrame: (f: SceneFrame, turnAnim?: { active: boolean; mix: number; seed: number }) => void;
  setFire: (firePower: number, ashCm: number, phase: 'roast' | 'cool') => void;
  setLayerHeats: (v: [number, number, number]) => void;
  dispose: () => void;
  onPick: (cb: (info: PickedInfo | null) => void) => void;
}

export function createPlayer(adapter: SceneAdapter, cfg: BasketConfig, height = 560): PlayerHandle {
  const canvas = h('canvas') as HTMLCanvasElement;
  const hud = h('div', { class: 'hud' });
  const viewport = h('div', { class: 'viewport', style: `height:${height}px` }, canvas,
    h('div', { class: 'toolbar' },
      h('button', { class: 'small', onclick: () => toggle('heat') }, '炭温热力'),
      h('button', { class: 'small', onclick: () => toggle('cut') }, '切剖面'),
    ),
    hud,
    h('div', { class: 'legend' },
      h('div', { class: 'muted' }, '颗粒火功色带（青褐 → 乌褐 → 黑褐）'),
      heatLegend(),
      h('div', { class: 'ends' }, h('span', {}, '轻/青'), h('span', {}, '足/焦')),
    ),
  );

  let scene: RoastScene | null = null;
  queueMicrotask(() => {
    scene = new RoastScene(canvas, adapter, cfg);
    scene.onPick = pickCb;
    scene.pushFrame(adapter.initial());
  });

  let pickCb: ((info: PickedInfo | null) => void) | null = null;
  const state = { heat: true, cut: false };

  function toggle(k: 'heat' | 'cut'): void {
    if (!scene) return;
    if (k === 'heat') { state.heat = !state.heat; scene.opts.showHeatmap = state.heat; }
    else { state.cut = !state.cut; scene.opts.showCut = state.cut; }
  }

  return {
    viewport,
    scene: () => scene,
    setFrame: (f, anim) => scene?.pushFrame(f, anim),
    setFire: (fp, ash, phase) => {
      if (!scene) return;
      scene.opts.firePower = fp; scene.opts.ashCm = ash; scene.opts.phase = phase;
      hud.innerHTML = '';
      hud.append(
        h('div', {}, h('b', {}, phase === 'roast' ? '上焙中' : '摊凉中')),
        h('div', {}, `火力 ${(fp * 100).toFixed(0)}%　盖灰 ${ash.toFixed(1)}cm`),
        h('div', { class: 'muted' }, '点任意颗粒查看它的完整温度历程'),
      );
    },
    setLayerHeats: (v) => { if (scene) scene.opts.layerHeats = v; },
    onPick: (cb) => { pickCb = cb; },
    dispose: () => scene?.dispose(),
  };
}

/** 剖面高度滑杆（床高范围内切一刀） */
export function cutSlider(sceneRef: () => RoastScene | null, maxHeightM: number): HTMLElement {
  const val = h('span', { class: 'mono' }, '0.05');
  return h('label', { class: 'field' },
    h('span', {}, '剖切高度（距笼箅） ' , val, ' m'),
    h('input', {
      type: 'range', min: '0.005', max: maxHeightM.toFixed(3), step: '0.002', value: '0.05',
      oninput: (e: Event) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        val.textContent = v.toFixed(3);
        const s = sceneRef();
        if (s) { s.opts.showCut = true; s.opts.cutHeightM = v; }
      },
    }),
  );
}
