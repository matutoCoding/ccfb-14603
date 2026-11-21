// 页面二：焙窟/焙笼配置（实际尺寸、炭种炭量、盖灰厚度，三维看温度分布）
import { h, mount, toast } from '../ui/dom';
import { repo, uid } from '../data/repo';
import { RoastScene } from '../webgl/scene';
import { LiveAdapter } from '../webgl/adapter';
import { RoastEngine } from '../sim/engine';
import { heatLegend } from '../ui/charts';
import type { BasketConfig, CharcoalKind } from '../types';

const CHARCOALS: CharcoalKind[] = ['荔枝木炭', '龙眼木炭', '枣木炭', '硬杂木炭'];

export async function basketsPage(main: HTMLElement): Promise<void> {
  const list = await repo.baskets.all();
  const selected = list[0];

  const viewport = h('div', { class: 'viewport' }, h('canvas'));
  let scene: RoastScene | null = null;

  const previewState = {
    firePower: 0.65,
    ashCm: selected?.ashThicknessCm ?? 3,
  };

  const ashLabel = h('span', { class: 'mono' }, String(previewState.ashCm));
  const fireLabel = h('span', { class: 'mono' }, String(previewState.firePower));

  function openPreview(cfg: BasketConfig): void {
    scene?.dispose();
    // 用一个 200 颗粒的微型引擎驱动预览（只取静态几何与相机，不跑时间）
    const engine = new RoastEngine({
      recordId: 'preview', pelletCount: 200,
      bedRadiusM: cfg.basketDiameterCm / 200, bedThicknessM: 0.05,
      sessions: [], totalDurationSec: 1, targetGrade: '中火',
      initialMoisturePct: 7, seed: 7,
    });
    const adapter = new LiveAdapter(engine, 1);
    scene = new RoastScene(viewport.querySelector('canvas') as HTMLCanvasElement, adapter, cfg);
    scene.opts.firePower = previewState.firePower;
    scene.opts.ashCm = previewState.ashCm;
    scene.pushFrame(adapter.initial());
  }

  if (selected) queueMicrotask(() => openPreview(selected));

  const formCard = h('div', { class: 'card' },
    h('h2', {}, '焙窟 / 焙笼参数'),
    formBody(),
  );

  function formBody(): HTMLElement {
    const f = {
      name: textF('配置名称'),
      pitD: numF('焙窟口径 cm', 72, 40, 120),
      pitH: numF('焙窟深度 cm', 46, 20, 90),
      basD: numF('焙笼内径 cm', 68, 40, 110),
      basH: numF('焙笼高度 cm', 34, 20, 60),
      gap: numF('笼底距炭面 cm', 26, 10, 50),
      charcoal: selectF('炭的种类', CHARCOALS),
      kg: numF('炭量 kg', 6.5, 1, 20, 0.1),
      ash: numF('盖灰厚度 cm', 3, 0, 10, 0.1),
    };
    f.name.el.value = selected?.name ?? '';
    if (selected) {
      f.pitD.el.value = String(selected.pitDiameterCm);
      f.pitH.el.value = String(selected.pitDepthCm);
      f.basD.el.value = String(selected.basketDiameterCm);
      f.basH.el.value = String(selected.basketHeightCm);
      f.gap.el.value = String(selected.gapToCharcoalCm);
      f.charcoal.el.value = selected.charcoal;
      f.kg.el.value = String(selected.charcoalKg);
      f.ash.el.value = String(selected.ashThicknessCm);
    }

    const rebuild = () => {
      const cfg = collect(f);
      previewState.ashCm = cfg.ashThicknessCm;
      ashLabel.textContent = cfg.ashThicknessCm.toFixed(1);
      openPreview(cfg);
    };
    [f.pitD, f.pitH, f.basD, f.basH, f.gap].forEach((x) => x.el.addEventListener('input', rebuild));
    f.ash.el.addEventListener('input', () => {
      previewState.ashCm = parseFloat(f.ash.el.value) || 0;
      ashLabel.textContent = previewState.ashCm.toFixed(1);
      if (scene) scene.opts.ashCm = previewState.ashCm;
    });

    return h('div', {},
      h('div', { class: 'grid cols-3' },
        f.name.wrap, f.charcoal.wrap, f.kg.wrap,
        f.pitD.wrap, f.pitH.wrap, f.gap.wrap,
        f.basD.wrap, f.basH.wrap, f.ash.wrap,
      ),
      h('div', { style: 'height:12px' }),
      h('div', { class: 'card', style: 'background:var(--panel-2)' },
        h('div', { class: 'row' },
          h('strong', {}, '盖灰厚度联动（看右侧三维：灰越厚，炭面温度分布越平）'),
          h('div', { class: 'spacer' }),
          h('span', {}, '盖灰 '), ashLabel, h('span', { class: 'muted' }, 'cm'),
        ),
        h('input', {
          type: 'range', min: '0', max: '8', step: '0.1',
          value: previewState.ashCm,
          oninput: (e: Event) => {
            const v = parseFloat((e.target as HTMLInputElement).value);
            previewState.ashCm = v; f.ash.el.value = String(v);
            ashLabel.textContent = v.toFixed(1);
            if (scene) scene.opts.ashCm = v;
          },
        }),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('span', {}, '炭火旺盛度 '), fireLabel,
          h('input', {
            type: 'range', min: '0.2', max: '1', step: '0.01', value: previewState.firePower,
            style: 'flex:1',
            oninput: (e: Event) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              previewState.firePower = v; fireLabel.textContent = v.toFixed(2);
              if (scene) scene.opts.firePower = v;
            },
          }),
        ),
      ),
      h('div', { style: 'height:12px' }),
      h('div', { class: 'row' },
        h('button', {
          onclick: async () => {
            if (!f.name.el.value.trim()) return toast('请填写配置名称');
            const cfg = collect(f);
            await repo.baskets.save(cfg);
            toast('焙窟配置已保存：' + cfg.name);
            basketsPage(main);
          },
        }, '保存配置'),
        h('button', {
          class: 'ghost', onclick: () => {
            f.name.el.value = '新焙窟 ' + (list.length + 1) + '号';
          },
        }, '清空编号（新建）'),
      ),
    );
  }

  const listCard = h('div', { class: 'card' },
    h('h2', {}, `焙窟配置（${list.length}）`),
    h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, '名称'), h('th', {}, '窟口径/深'), h('th', {}, '笼径/高'),
        h('th', {}, '笼底距炭'), h('th', {}, '炭种/炭量'), h('th', {}, '盖灰'), h('th', {}, '操作'),
      )),
      h('tbody', {}, ...list.map((b) =>
        h('tr', {},
          h('td', {}, b.name),
          h('td', { class: 'num' }, `${b.pitDiameterCm}/${b.pitDepthCm}cm`),
          h('td', { class: 'num' }, `${b.basketDiameterCm}/${b.basketHeightCm}cm`),
          h('td', { class: 'num' }, b.gapToCharcoalCm + 'cm'),
          h('td', {}, `${b.charcoal} ${b.charcoalKg}kg`),
          h('td', { class: 'num' }, b.ashThicknessCm + 'cm'),
          h('td', {}, h('button', {
            class: 'small ghost', onclick: () => basketsPage(main).then(() => openById(b.id)),
          }, '载入预览'), h('button', {
            class: 'small danger', style: 'margin-left:6px',
            onclick: async () => {
              if (!confirm(`删除配置「${b.name}」？`)) return;
              await repo.baskets.remove(b.id);
              basketsPage(main);
            },
          }, '删除')),
        ),
      )),
    ),
  );

  function openById(id: string): void {
    repo.baskets.get(id).then((cfg) => { if (cfg) openPreview(cfg); });
  }

  mount(main, h('div', {},
    h('h1', {}, '焙窟与焙笼配置'),
    h('p', { class: 'sub' }, '按实际尺寸建窟；炭种、炭量、盖灰厚度可调。三维中炭面颜色即炭火由中心向外的温度分布，盖灰越厚径向越平。'),
    h('div', { class: 'grid cols-2' },
      h('div', {}, formCard, listCard),
      h('div', { class: 'card' },
        h('h2', {}, '三维预览'),
        viewport,
        h('div', { class: 'legend' },
          h('div', { class: 'muted' }, '炭面温度（暗红外 → 亮橙黄）'),
          heatLegend(),
          h('div', { class: 'ends' }, h('span', {}, '低温/边缘'), h('span', {}, '高温/中心')),
        ),
      ),
    ),
  ));
}

interface F { wrap: HTMLElement; el: HTMLInputElement | HTMLSelectElement; }
function textF(label: string): F {
  const el = h('input', {}) as HTMLInputElement;
  return { wrap: h('label', { class: 'field' }, label, el), el };
}
function numF(label: string, value: number, min: number, max: number, step = 1): F {
  const el = h('input', { type: 'number', value, min, max, step }) as HTMLInputElement;
  return { wrap: h('label', { class: 'field' }, label, el), el };
}
function selectF(label: string, opts: string[]): F {
  const el = h('select', {}, ...opts.map((o) => h('option', { value: o }, o))) as HTMLSelectElement;
  return { wrap: h('label', { class: 'field' }, label, el), el };
}
function collect(f: Record<string, F>): BasketConfig {
  return {
    id: uid('basket'),
    name: f.name.el.value.trim() || '未命名焙窟',
    pitDiameterCm: parseFloat(f.pitD.el.value),
    pitDepthCm: parseFloat(f.pitH.el.value),
    basketDiameterCm: parseFloat(f.basD.el.value),
    basketHeightCm: parseFloat(f.basH.el.value),
    gapToCharcoalCm: parseFloat(f.gap.el.value),
    charcoal: f.charcoal.el.value as CharcoalKind,
    charcoalKg: parseFloat(f.kg.el.value),
    ashThicknessCm: parseFloat(f.ash.el.value),
  };
}
