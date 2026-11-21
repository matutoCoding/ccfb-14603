// 页面一：毛茶批次登记
import { h, mount, toast, num } from '../ui/dom';
import { repo, uid, computeBatchThickness } from '../data/repo';
import type { TeaBatch, GreenCraft } from '../types';

const CRAFTS: GreenCraft[] = ['清香型', '韵香型', '浓香型'];

interface FieldWrap { wrap: HTMLElement; value: () => string; }

function textField(label: string, placeholder = ''): FieldWrap {
  const el = h('input', { placeholder }) as HTMLInputElement;
  return { wrap: h('label', { class: 'field' }, label, el), value: () => el.value };
}
function numField(label: string, value: number, min: number, max: number, step: number, onInput?: () => void): FieldWrap {
  const el = h('input', { type: 'number', value, min, max, step }) as HTMLInputElement;
  if (onInput) el.addEventListener('input', onInput);
  return { wrap: h('label', { class: 'field' }, label, el), value: () => el.value };
}
function selectField(label: string, opts: string[]): FieldWrap {
  const el = h('select', {}, ...opts.map((o) => h('option', { value: o }, o))) as HTMLSelectElement;
  return { wrap: h('label', { class: 'field' }, label, el), value: () => el.value };
}

export async function batchesPage(main: HTMLElement): Promise<void> {
  const list = await repo.batches.all();

  const thickVal = h('div', { class: 'v mono' }, '—');
  const fields = {
    name: textField('批次名称', '例：2026秋 感德铁观音四号'),
    mountain: textField('山场', '例：感德镇高山'),
    craft: selectField('做青工艺', CRAFTS),
    moisture: numField('含水率 %', 7.0, 0.5, 15, 0.1),
    tightness: numField('条索紧结度 0..1', 0.7, 0, 1, 0.01, refresh),
    diameter: numField('焙笼内径 cm', 68, 40, 100, 1, refresh),
    load: numField('一笼投茶量 kg（1斤=0.5kg）', 4.0, 0.5, 12, 0.1, refresh),
  };
  function refresh(): void {
    const t = computeBatchThickness({
      teaLoadKg: parseFloat(fields.load.value()) || 0,
      basketDiameterCm: parseFloat(fields.diameter.value()) || 1,
      tightness: parseFloat(fields.tightness.value()) || 0,
    });
    thickVal.textContent = num(t, 2) + ' cm';
  }
  refresh();

  const saveBtn = h('button', {
    onclick: async () => {
      if (!fields.name.value().trim()) return toast('请填写批次名称');
      const b: TeaBatch = {
        id: uid('batch'),
        name: fields.name.value().trim(),
        variety: '铁观音',
        mountain: fields.mountain.value().trim() || '未填',
        craft: fields.craft.value() as GreenCraft,
        moisturePct: parseFloat(fields.moisture.value()),
        tightness: parseFloat(fields.tightness.value()),
        basketDiameterCm: parseFloat(fields.diameter.value()),
        teaLoadKg: parseFloat(fields.load.value()),
        layerThicknessCm: parseFloat(thickVal.textContent!),
        pelletCount: 5000,
        createdAt: Date.now(),
      };
      await repo.batches.save(b);
      toast('批次已登记：' + b.name);
      batchesPage(main);
    },
  }, '登记入册');

  const formCard = h('div', { class: 'card' },
    h('h2', {}, '毛茶批次登记'),
    h('div', { class: 'grid cols-4' },
      fields.name.wrap, fields.mountain.wrap, fields.craft.wrap, fields.moisture.wrap,
      fields.tightness.wrap, fields.diameter.wrap, fields.load.wrap,
    ),
    h('div', { style: 'height:12px' }),
    h('div', { class: 'row' },
      h('div', { class: 'stat' }, thickVal,
        h('div', { class: 'l' }, '自动计算：铺茶厚度 cm（松装密度随紧结度修正）')),
      h('div', { class: 'spacer' }), saveBtn,
    ),
  );

  const tableCard = h('div', { class: 'card' },
    h('h2', {}, `在册毛茶批次（${list.length}）`),
    list.length === 0
      ? h('div', { class: 'empty' }, '暂无批次，请先登记')
      : h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '批次'), h('th', {}, '品种'), h('th', {}, '山场'), h('th', {}, '做青'),
          h('th', {}, '含水率'), h('th', {}, '紧结度'), h('th', {}, '投茶量'),
          h('th', {}, '笼径'), h('th', {}, '铺茶厚度'), h('th', {}, '颗粒'), h('th', {}, '操作'),
        )),
        h('tbody', {}, ...list.map((b) =>
          h('tr', {},
            h('td', {}, b.name),
            h('td', {}, b.variety),
            h('td', {}, b.mountain),
            h('td', {}, b.craft),
            h('td', { class: 'num' }, b.moisturePct.toFixed(1) + '%'),
            h('td', { class: 'num' }, b.tightness.toFixed(2)),
            h('td', { class: 'num' }, b.teaLoadKg.toFixed(1) + 'kg'),
            h('td', { class: 'num' }, b.basketDiameterCm + 'cm'),
            h('td', { class: 'num' }, h('b', {}, b.layerThicknessCm.toFixed(2) + 'cm')),
            h('td', { class: 'num' }, b.pelletCount.toLocaleString()),
            h('td', {}, h('button', {
              class: 'small ghost', onclick: async () => {
                if (!confirm(`删除批次「${b.name}」？相关焙火记录仍会保留但无法重跑。`)) return;
                await repo.batches.remove(b.id);
                batchesPage(main);
              },
            }, '删除')),
          ),
        )),
      ),
  );

  mount(main, h('div', {},
    h('h1', {}, '毛茶批次'),
    h('p', { class: 'sub' }, '按品种、山场、做青工艺登记，录入含水率与条索紧结度；投茶量与笼径确定后自动计算铺茶厚度。'),
    formCard, tableCard,
  ));
}
