// 页面四：成茶对比 —— 两笼并排三维、火功分布、三档对标、层差、复焙前后、颗粒追溯
import { h, mount, toast, gradeTag, num, fmtTime } from '../ui/dom';
import { repo, gradeDeltaText, GRADE_ORDER } from '../data/repo';
import { StaticAdapter } from '../webgl/adapter';
import { createPlayer, cutSlider, type PlayerHandle } from '../ui/player';
import { openPelletDrawer } from '../ui/drawer';
import { histogramChart, temperatureChart } from '../ui/charts';
import { GRADE_CENTER } from '../sim/temperature';
import type { RoastRecord, RoastResult } from '../types';

export async function comparePage(main: HTMLElement): Promise<void> {
  const records = (await repo.records.all()).filter((r) => r.summary);
  if (records.length < 1) {
    mount(main, h('div', {}, h('h1', {}, '成茶对比'),
      h('div', { class: 'card empty' }, '暂无已完成仿真的记录，请先到焙火过程页跑一条并落库。')));
    return;
  }

  const selA = h('select', {}, ...records.map((r) => h('option', { value: r.id }, r.code))) as HTMLSelectElement;
  const selB = h('select', {}, ...records.map((r) =>
    h('option', { value: r.id, selected: r.id === records[Math.min(1, records.length - 1)].id }, r.code))) as HTMLSelectElement;

  const stageA = h('div', {});
  const stageB = h('div', {});
  let players: PlayerHandle[] = [];

  async function renderPair(): Promise<void> {
    players.forEach((p) => p.dispose());
    players = [];
    stageA.innerHTML = ''; stageB.innerHTML = '';
    const [a, b] = await Promise.all([selA.value, selB.value].map((id) => repo.records.get(id)));
    if (!a || !b) return;
    stageA.append(await buildPanel(a, '甲笼'));
    stageB.append(await buildPanel(b, '乙笼'));
  }

  async function buildPanel(rec: RoastRecord, label: string): Promise<HTMLElement> {
    const result = await repo.results.get(rec.resultId ?? '');
    const batch = await repo.batches.get(rec.batchId);
    const basket = await repo.baskets.get(rec.basketId);
    if (!result || !basket) return h('div', { class: 'empty' }, '结果尚未落库');
    const s = result.summary;

    const adapter = new StaticAdapter(result);
    const player = createPlayer(adapter, basket, 420);
    players.push(player);

    // 时间回放（静态结果拖动）
    const seek = h('input', {
      type: 'range', min: '0', max: String(adapter.totalT), step: '20', value: String(adapter.totalT),
    }) as HTMLInputElement;
    seek.addEventListener('input', () => {
      const t = parseFloat(seek.value);
      player.setFrame(adapter.frameAt(t));
    });
    queueMicrotask(() => player.setFrame(adapter.frameAt(adapter.totalT)));

    player.onPick((info) => {
      if (!info) return;
      openPelletDrawer({
        pelletId: info.id, result,
        currentHeat: result.heat[info.id],
        currentTemp: info.temp,
        finalScorch: result.scorch[info.id],
        finalLayer: result.finalLayer[info.id],
        maxTemp: result.maxTemp[info.id],
      });
    });

    const delta = s.gradeDelta;
    const layerDiff = Math.max(...s.layerMean) - Math.min(...s.layerMean);

    return h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('h2', { style: 'margin:0' }, `${label} · ${rec.code}`),
        h('div', { class: 'spacer' }),
        gradeTag(s.grade, `目标${rec.targetGrade}`),
      ),
      h('p', { class: 'sub', style: 'margin:8px 0' },
        `${batch?.name ?? ''}｜总时长 ${fmtTime(rec.totalDurationSec)}｜翻焙 ${result.turns.length} 次`),
      player.viewport,
      cutSlider(() => player.scene(), (batch?.layerThicknessCm ?? 8) / 100 * 1.2),
      h('div', { class: 'row', style: 'margin:8px 0' },
        h('span', { class: 'muted' }, '回放时间轴'), seek,
      ),
      h('div', { class: 'grid cols-4' },
        stat('平均火功', num(s.meanHeat, 3)),
        stat('火功标准差', num(s.stdHeat, 3)),
        stat('均匀度', num(s.uniformPct, 1) + '%'),
        stat('焦斑颗粒', num(s.scorchPct, 2) + '%', s.scorchPct > 3),
        stat('底层焦损', num(s.bottomScorchPct, 2) + '%', s.bottomScorchPct > 3),
        stat('上/中/下层差', num(layerDiff, 3), layerDiff > 0.25),
        stat('终含水率', num(s.finalMoisturePct, 2) + '%'),
        stat('火功区间', `${num(s.minHeat, 2)}~${num(s.maxHeat, 2)}`),
      ),
      h('div', { style: 'margin-top:10px' },
        h('strong', { class: delta === 0 ? 'good-text' : 'warn' }, '对标厂内三档：'),
        h('span', { style: 'margin-left:8px' }, gradeDeltaText(delta)),
        h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' },
          `三档中心值：轻火 ${GRADE_CENTER.轻火} / 中火 ${GRADE_CENTER.中火} / 足火 ${GRADE_CENTER.足火}；本笼均值 ${num(s.meanHeat, 3)}`),
      ),
      h('h2', {}, '火功均匀度分布'),
      histogramChart(result.heat),
      h('h2', {}, '上中下三层平均火功'),
      layerBars(s.layerMean),
      h('h2', {}, '焙火环境曲线'),
      temperatureChart({
        height: 170,
        nodes: result.turns.map((t, i) => ({ t: t.atSec, label: `翻${i + 1}`, kind: 'turn' })),
        series: [
          { name: '中心 ℃', color: '#e0a860', points: result.envCurve.map((p) => ({ t: p.t, v: p.centerTemp })) },
          { name: '边缘 ℃', color: '#6f95b8', points: result.envCurve.map((p) => ({ t: p.t, v: p.edgeTemp })) },
        ],
      }),
    );
  }

  selA.addEventListener('change', renderPair);
  selB.addEventListener('change', renderPair);

  // 复焙前后对比（R1 有多个 roast 会话）
  const reRoastBox = h('div', { class: 'card' },
    h('h2', {}, '复焙前后颜色 / 火功对比（含摊凉再复焙的记录）'),
    h('div', { id: 'reroast' }),
  );
  queueMicrotask(async () => {
    const host = reRoastBox.querySelector('#reroast') as HTMLElement;
    const multi = records.filter((r) => r.sessions.filter((s) => s.phase === 'roast').length > 1);
    if (!multi.length) {
      host.append(h('div', { class: 'muted' }, '当前种子数据中 R001 含「初焙 → 摊凉3天 → 复焙」，若未显示请先落库。'));
      return;
    }
    for (const rec of multi) {
      const result = await repo.results.get(rec.resultId ?? '');
      if (!result) continue;
      const roastSessions = rec.sessions.filter((s) => s.phase === 'roast');
      const t1End = roastSessions[0].startOffsetSec + roastSessions[0].durationSec;
      const t2Start = roastSessions[1].startOffsetSec;
      const before = new StaticAdapter(result).frameAt(t1End);
      const after = new StaticAdapter(result).frameAt(result.histTimes[result.histTimes.length - 1]);
      const meanAt = (frame: typeof before) => frame.heat.reduce((a, b) => a + b, 0) / frame.heat.length;
      host.append(h('div', { class: 'grid cols-2' },
        h('div', { class: 'stat' },
          h('div', { class: 'l' }, `${rec.code} 初焙出焙（${fmtTime(t1End)}）`),
          h('div', { class: 'v' }, '均火功 ' + num(meanAt(before), 3)),
          h('div', { class: 'muted', style: 'font-size:12px' }, `摊凉 ${fmtTime(t2Start - t1End)} 后再复焙`),
        ),
        h('div', { class: 'stat' },
          h('div', { class: 'l' }, `复焙出焙（${fmtTime(rec.totalDurationSec)}）`),
          h('div', { class: 'v' }, '均火功 ' + num(meanAt(after), 3)),
          h('div', { class: 'muted', style: 'font-size:12px' }, `复焙增量 ${num(meanAt(after) - meanAt(before), 3)}，颜色整体转乌褐`),
        ),
      ));
    }
  });

  mount(main, h('div', {},
    h('h1', {}, '成茶对比'),
    h('p', { class: 'sub' }, '两笼成茶并排：火功均匀度分布、层间火功差、与厂内轻/中/足火三档对标；点颗粒可追溯完整历程。'),
    h('div', { class: 'card row' },
      h('strong', {}, '甲笼'), selA,
      h('strong', { style: 'margin-left:16px' }, '乙笼'), selB,
      h('div', { class: 'spacer' }),
      h('button', { class: 'small ghost', onclick: () => { toast('可在两个下拉中任选记录换对比'); } }, '对比说明'),
    ),
    h('div', { class: 'grid cols-2' }, stageA, stageB),
    reRoastBox,
    h('div', { class: 'card' },
      h('h2', {}, '全记录档位总览'),
      h('table', {},
        h('thead', {}, h('tr', {}, ...['编号', '目标档', '实际档', '均值', '均匀度', '焦斑%', '底层焦%', '偏档'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...records.map((r) => {
          const s = r.summary!;
          return h('tr', {},
            h('td', {}, r.code),
            h('td', {}, gradeTag(r.targetGrade)),
            h('td', {}, gradeTag(s.grade)),
            h('td', { class: 'num' }, num(s.meanHeat, 3)),
            h('td', { class: 'num' }, num(s.uniformPct, 1) + '%'),
            h('td', { class: 'num' }, num(s.scorchPct, 2)),
            h('td', { class: s.bottomScorchPct > 3 ? 'num bad-text' : 'num' }, num(s.bottomScorchPct, 2)),
            h('td', {}, gradeDeltaText(s.gradeDelta)),
          );
        })),
      ),
      h('p', { class: 'muted', style: 'font-size:12px' },
        '三档阈值：火功 < 0.62 轻火，< 1.25 中火，≥1.25 足火，≥1.80 过火。'),
    ),
  ));

  await renderPair();
}

function stat(l: string, v: string, warn = false): HTMLElement {
  return h('div', { class: 'stat' },
    h('div', { class: 'v', style: `font-size:17px;${warn ? 'color:var(--red)' : ''}` }, v),
    h('div', { class: 'l' }, l));
}

function layerBars(means: [number, number, number]): HTMLElement {
  const max = Math.max(...means, 0.1);
  const names = ['上层', '中层', '下层'];
  return h('div', {}, ...means.map((v, i) =>
    h('div', { class: 'row', style: 'margin:6px 0' },
      h('span', { style: 'width:42px' }, names[i]),
      h('div', { style: `flex:1;height:14px;background:var(--panel-2);border-radius:7px;overflow:hidden` },
        h('div', {
          style: `height:100%;width:${(v / max) * 100}%;background:linear-gradient(90deg,#6e5634,#c8853c)`,
        }),
      ),
      h('span', { class: 'mono', style: 'width:64px;text-align:right' }, num(v, 3)),
    ),
  ));
}
