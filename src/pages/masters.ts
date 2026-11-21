// 页面五：师傅档案 —— 招牌焙火曲线、新人照老师傅曲线焙、偏差节点提醒
import { h, mount, toast, fmtTime, fmtClock, gradeTag, num } from '../ui/dom';
import { repo } from '../data/repo';
import { temperatureChart, type ChartNode } from '../ui/charts';
import { GRADE_CENTER } from '../sim/temperature';
import type { MasterProfile, RoastNode, RoastSession, RoastRecord } from '../types';

export async function mastersPage(main: HTMLElement): Promise<void> {
  const masters = await repo.masters.all();
  const records = await repo.records.all();

  const cards = masters.map((m) => masterCard(m, records));

  // 偏差分析：新人记录 vs 跟随的老师傅曲线
  const followerBox = h('div', { class: 'card' },
    h('h2', {}, '照老师傅曲线焙：节点偏差提醒'),
    h('div', { id: 'follow' }),
  );
  queueMicrotask(async () => {
    const host = followerBox.querySelector('#follow') as HTMLElement;
    const followed = records.filter((r) => r.followMasterId);
    if (!followed.length) {
      host.append(h('div', { class: 'muted' }, '暂无跟随记录（种子数据中吴阿炭 R003 跟随陈德炉）。'));
      return;
    }
    for (const rec of followed) {
      const master = await repo.masters.get(rec.followMasterId!);
      if (!master) continue;
      host.append(deviationPanel(rec, master));
    }
  });

  mount(main, h('div', {},
    h('h1', {}, '师傅档案'),
    h('p', { class: 'sub' }, '每位师傅的招牌焙火曲线存档；新人按老师傅曲线焙，系统逐节点比对时间/火力/盖灰，偏差大即提醒。'),
    h('div', { class: 'grid cols-3' }, ...cards),
    followerBox,
  ));
}

function masterCard(m: MasterProfile, records: RoastRecord[]): HTMLElement {
  const myRecords = records.filter((r) => r.masterId === m.id);
  const curve = m.signatureCurve;
  const nodes: ChartNode[] = curve.nodes
    .filter((n) => n.kind === 'turn' || n.kind === 'pressAsh')
    .map((n) => ({ t: n.tSec, label: n.label ?? n.kind, kind: n.kind }));
  // 构造一条示意火力曲线（压灰节点处阶跃）
  const pts: { t: number; v: number }[] = [];
  let fp = curve.firePower * 100;
  let ash = curve.ashThicknessCm;
  const step = curve.durationSec / 40;
  for (let t = 0; t <= curve.durationSec; t += step) {
    for (const n of curve.nodes) {
      if (n.kind === 'pressAsh' && Math.abs(n.tSec - t) < step) {
        if (n.firePower != null) fp = n.firePower * 100;
        if (n.ashThicknessCm != null) ash = n.ashThicknessCm;
      }
    }
    pts.push({ t, v: fp });
  }
  void ash;

  return h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('h2', { style: 'margin:0' }, m.name),
      h('div', { class: 'spacer' }), gradeTag(m.typicalGrade),
    ),
    h('p', { class: 'sub', style: 'margin:6px 0' }, `${m.title}｜从业 ${m.years} 年`),
    h('div', { style: 'font-size:13px' }, h('b', {}, '擅长：'), m.specialty),
    h('div', { class: 'muted', style: 'font-size:12.5px;margin:6px 0' }, m.note),
    h('div', { class: 'kv', style: 'grid-template-columns:80px 1fr' },
      h('span', { class: 'k' }, '标准时长'), h('span', {}, fmtTime(curve.durationSec)),
      h('span', { class: 'k' }, '基准火力'), h('span', { class: 'mono' }, (curve.firePower * 100).toFixed(0) + '%'),
      h('span', { class: 'k' }, '盖灰厚度'), h('span', { class: 'mono' }, curve.ashThicknessCm + ' cm'),
      h('span', { class: 'k' }, '翻焙次数'), h('span', {}, String(nodes.filter((n) => n.kind === 'turn').length)),
      h('span', { class: 'k' }, '在档记录'), h('span', {}, String(myRecords.length)),
    ),
    h('div', { style: 'font-size:12px;color:var(--fg-dim)' }, '招牌曲线 · 火力%（竖线为翻焙/压灰节点）'),
    temperatureChart({ height: 150, nodes, series: [{ name: '火力 %', color: '#c8853c', points: pts }] }),
  );
}

/** 跟随曲线偏差分析 */
function deviationPanel(rec: RoastRecord, master: MasterProfile): HTMLElement {
  const ref = master.signatureCurve;
  const mine = rec.sessions.find((s) => s.phase === 'roast');
  if (!mine) return h('div');

  const refTurns = ref.nodes.filter((n) => n.kind === 'turn').sort((a, b) => a.tSec - b.tSec);
  const myTurns = mine.nodes.filter((n) => n.kind === 'turn').sort((a, b) => a.tSec - b.tSec);
  const refPress = ref.nodes.filter((n) => n.kind === 'pressAsh');
  const myPress = mine.nodes.filter((n) => n.kind === 'pressAsh');

  const rows: { label: string; ref: string; mine: string; deltaMin: number; severe: boolean }[] = [];
  const pairN = Math.max(refTurns.length, myTurns.length);
  for (let i = 0; i < pairN; i++) {
    const a: RoastNode | undefined = refTurns[i];
    const b: RoastNode | undefined = myTurns[i];
    const dMin = a && b ? (b.tSec - a.tSec) / 60 : (a ? 999 : -999);
    rows.push({
      label: `第 ${i + 1} 次翻焙`,
      ref: a ? fmtClock(a.tSec) : '无此节点',
      mine: b ? fmtClock(b.tSec) : '漏翻',
      deltaMin: dMin,
      severe: Math.abs(dMin) >= 20,
    });
  }
  // 压灰对比（按出现顺序）
  for (let i = 0; i < Math.max(refPress.length, myPress.length); i++) {
    const a = refPress[i], b = myPress[i];
    rows.push({
      label: `第 ${i + 1} 次压灰`,
      ref: a ? `${fmtClock(a.tSec)} → ${a.ashThicknessCm}cm` : '无',
      mine: b ? `${fmtClock(b.tSec)} → ${b.ashThicknessCm}cm` : '无',
      deltaMin: a && b ? (b.tSec - a.tSec) / 60 : 60,
      severe: !a || !b || Math.abs((b.tSec - a.tSec) / 60) >= 20 || (b.ashThicknessCm ?? 0) - (a.ashThicknessCm ?? 0) > 0.5,
    });
  }
  // 基准火力偏差
  const fpDelta = (mine.firePower - ref.firePower) * 100;

  const severeCount = rows.filter((r) => r.severe).length;
  const summary = rec.summary;

  const card = h('div', { class: 'card', ...(severeCount ? { style: 'border-color:var(--red)' } : {}) },
    h('div', { class: 'row' },
      h('h2', { style: 'margin:0' }, `${rec.code} · 焙茶工跟随 ${master.name}`),
      h('div', { class: 'spacer' }),
      severeCount
        ? h('span', { class: 'tag bad' }, `${severeCount} 个节点偏差超限`)
        : h('span', { class: 'tag good' }, '曲线吻合良好'),
    ),
    h('div', { style: 'margin:10px 0' },
      h('span', { class: fpDelta >= 8 ? 'tag bad' : 'tag' }, `起炉火力偏差 ${fpDelta >= 0 ? '+' : ''}${num(fpDelta, 0)}%`),
      ' ',
      h('span', { class: 'muted', style: 'font-size:12.5px' },
        fpDelta >= 8 ? '（起炭过旺，若不及时压灰底层将焦）' : '起炉火力在允许范围内'),
    ),
    h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '节点'), h('th', {}, '老师傅曲线'), h('th', {}, '本次操作'), h('th', {}, '时间偏差'), h('th', {}, '提醒'))),
      h('tbody', {}, ...rows.map((r) =>
        h('tr', {},
          h('td', {}, r.label),
          h('td', { class: 'mono' }, r.ref),
          h('td', { class: 'mono' }, r.mine),
          h('td', { class: 'num' }, r.deltaMin >= 990 ? '—' : (r.deltaMin >= 0 ? '+' : '') + num(r.deltaMin, 0) + ' 分'),
          h('td', {}, r.severe
            ? h('span', { class: 'bad-text' }, '⚠ 偏差超过 20 分钟，需复盘')
            : h('span', { class: 'good-text' }, '✓ 正常')),
        ),
      )),
    ),
    summary ? h('p', { class: 'muted', style: 'font-size:12.5px;margin-top:8px' },
      `最终结果：实际 ${summary.grade}（目标 ${rec.targetGrade}），均匀度 ${num(summary.uniformPct, 1)}%，` +
      `底层焦损 ${num(summary.bottomScorchPct, 2)}%；三档中心参考 轻${GRADE_CENTER.轻火}/中${GRADE_CENTER.中火}/足${GRADE_CENTER.足火}。`,
    ) : h('span'),
    rec.handwrittenNote ? h('p', { class: 'warn', style: 'font-size:12.5px' }, '手写记录：' + rec.handwrittenNote) : h('span'),
  );
  return card;
}
