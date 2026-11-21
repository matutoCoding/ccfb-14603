// 页面三：焙火过程 —— 时间轴仿真、翻焙/压灰节点编辑、实时三维、剖面、颗粒追溯
import { h, mount, toast, fmtTime, fmtClock } from '../ui/dom';
import { repo, uid, bedDims } from '../data/repo';
import { createEngine } from '../data/sim-service';
import { LiveAdapter } from '../webgl/adapter';
import { createPlayer, cutSlider, type PlayerHandle } from '../ui/player';
import { openPelletDrawer } from '../ui/drawer';
import { temperatureChart } from '../ui/charts';
import type {
  RoastRecord, RoastSession, RoastNode, NodeKind, TeaBatch, BasketConfig,
} from '../types';

const SPEEDS = [1, 4, 16, 64, 256];

export async function roastPage(main: HTMLElement, params: string[]): Promise<(() => void) | void> {
  const records = await repo.records.all();
  if (!records.length) {
    mount(main, h('div', {},
      h('h1', {}, '焙火过程'),
      h('div', { class: 'card empty' }, '还没有焙火记录，请先在毛茶批次页登记批次（种子数据含 4 条现成记录）。'),
    ));
    return;
  }
  const rec = (await repo.records.get(params[0])) ?? records[0];
  const batch = (await repo.batches.get(rec.batchId))!;
  const basket = (await repo.baskets.get(rec.basketId))!;

  let engine = createEngine(rec, batch, basket);
  const adapter = new LiveAdapter(engine, rec.totalDurationSec);
  const player = createPlayer(adapter, basket);

  let playing = false;
  let speedIdx = 2; // 16x
  let raf = 0;
  let lastWall = 0;
  let turnAnim: { start: number; mix: number; seed: number; fromT: number } | null = null;
  const seenTurns = new Set<number>();
  let closed = false;

  // ---------- 顶部信息 ----------
  const timeVal = h('span', { class: 'time mono' }, '00:00');
  const liveStats = h('div', { class: 'grid cols-4' });

  function renderStats(): void {
    let sum = 0, mx = 0;
    for (let i = 0; i < engine.count; i++) { sum += engine.heat[i]; mx = Math.max(mx, engine.temp[i]); }
    const mean = sum / engine.count;
    liveStats.innerHTML = '';
    liveStats.append(
      stat('仿真时间', fmtTime(engine.t)),
      stat('全笼平均火功', mean.toFixed(3)),
      stat('当前最高颗粒温', mx.toFixed(1) + '℃'),
      stat('阶段', engine.fire.phase === 'roast' ? '上焙' : '摊凉'),
    );
  }
  renderStats();

  // ---------- 时间轴节点编辑 ----------
  const nodeList = h('div', {});
  function renderNodes(): void {
    nodeList.innerHTML = '';
    rec.sessions.forEach((s, si) => {
      nodeList.append(h('div', { style: 'margin:8px 0 4px;color:var(--accent-2)' },
        `会话 ${si + 1} · ${s.phase === 'roast' ? '上焙' : '摊凉'} · 起始 ${fmtTime(s.startOffsetSec)} · 时长 ${fmtTime(s.durationSec)}`,
        s.phase === 'roast' ? ` · 基准火力 ${(s.firePower * 100).toFixed(0)}% · 盖灰 ${s.ashThicknessCm}cm` : '',
      ));
      const sorted = [...s.nodes].sort((a, b) => a.tSec - b.tSec);
      for (const n of sorted) {
        if (n.kind === 'start' || n.kind === 'end') {
          nodeList.append(nodeRow(s, n, true));
        } else {
          nodeList.append(nodeRow(s, n, false));
        }
      }
    });
  }

  function nodeRow(s: RoastSession, n: RoastNode, fixed: boolean): HTMLElement {
    const kindName: Record<NodeKind, string> = {
      turn: '翻焙', pressAsh: '压灰', start: '开始', end: '结束',
    };
    const color = n.kind === 'pressAsh' ? 'var(--blue)' : 'var(--accent)';
    return h('div', { class: 'row', style: 'margin:3px 0;font-size:13px' },
      h('span', { class: 'pill-node', style: `border-color:${color};color:${color}` }, kindName[n.kind]),
      h('span', { class: 'mono' }, fmtClock(n.tSec)),
      n.label ? h('span', { class: 'muted' }, n.label) : h('span'),
      n.source === 'handwritten' ? h('span', { class: 'tag' }, '手写录入') : h('span'),
      h('div', { class: 'spacer' }),
      fixed ? h('span') : h('button', {
        class: 'small ghost', onclick: () => {
          const v = prompt('节点时间（小时，可小数）', String(n.tSec / 3600));
          if (v == null) return;
          n.tSec = Math.max(0, Math.min(s.durationSec, parseFloat(v) * 3600));
          s.nodes.sort((a, b) => a.tSec - b.tSec);
          renderNodes(); toast('节点已调整，点「从头重跑」生效');
        },
      }, '改时间'),
      fixed ? h('span') : h('button', {
        class: 'small danger', onclick: () => {
          s.nodes = s.nodes.filter((x) => x.id !== n.id);
          renderNodes(); toast('节点已删除，点「从头重跑」生效');
        },
      }, '删'),
    );
  }
  renderNodes();

  function addNode(kind: NodeKind): void {
    const roastSessions = rec.sessions.filter((s) => s.phase === 'roast');
    const s = roastSessions[0];
    if (!s) return toast('没有可编辑的上焙会话');
    const localT = Math.max(0, engine.t - s.startOffsetSec);
    if (localT > s.durationSec) return toast('当前不在上焙会话内');
    if (kind === 'turn') {
      s.nodes.push({ id: uid('n'), tSec: localT, kind: 'turn', label: `翻焙@${fmtClock(localT)}` });
    } else {
      const ash = parseFloat(prompt('压灰后的盖灰厚度 cm', String(engine.fire.ashCm + 1)) || 'NaN');
      if (Number.isNaN(ash)) return;
      s.nodes.push({
        id: uid('n'), tSec: localT, kind: 'pressAsh',
        ashThicknessCm: ash, label: `压灰至${ash}cm`,
      });
    }
    s.nodes.sort((a, b) => a.tSec - b.tSec);
    renderNodes();
    toast('节点已加入时间轴，点「从头重跑」生效');
  }

  // ---------- 手写记录录入 ----------
  const hwBox = h('div', { class: 'card', style: 'background:var(--panel-2)' },
    h('strong', {}, '照师傅手写记录录入（文本解析）'),
    (() => {
      const ta = h('textarea', { rows: '3', placeholder: '例：1.5小时翻焙；3小时压灰到4cm；4.5小时翻焙' }) as HTMLTextAreaElement;
      return h('div', {}, ta,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', {
            class: 'small', onclick: () => {
              const s = rec.sessions.find((x) => x.phase === 'roast')!;
              const lines = ta.value.split(/[；;\n]/).map((x) => x.trim()).filter(Boolean);
              let added = 0;
              for (const line of lines) {
                const hm = line.match(/([\d.]+)\s*小时?/);
                if (!hm) continue;
                const t = parseFloat(hm[1]) * 3600;
                if (line.includes('翻')) {
                  s.nodes.push({ id: uid('n'), tSec: t, kind: 'turn', label: `手写翻焙 ${hm[1]}h`, source: 'handwritten' });
                  added++;
                } else if (line.includes('灰')) {
                  const am = line.match(/([\d.]+)\s*cm/);
                  s.nodes.push({
                    id: uid('n'), tSec: t, kind: 'pressAsh',
                    ashThicknessCm: am ? parseFloat(am[1]) : engine.fire.ashCm + 1,
                    label: '手写压灰', source: 'handwritten',
                  });
                  added++;
                }
              }
              s.nodes.sort((a, b) => a.tSec - b.tSec);
              renderNodes();
              toast(`已解析录入 ${added} 个节点，点「从头重跑」生效`);
            },
          }, '解析录入'),
        ));
    })(),
  );

  // ---------- 环境曲线图 ----------
  const chartHost = h('div', {});
  function renderChart(markerT: number): void {
    chartHost.innerHTML = '';
    const points = engine.environmentCurve;
    if (!points.length) {
      chartHost.append(h('div', { class: 'muted' }, '启动仿真后绘制温度曲线…'));
      return;
    }
    const nodes = rec.sessions.flatMap((s) =>
      s.nodes.filter((n) => n.kind === 'turn' || n.kind === 'pressAsh').map((n) => ({
        t: s.startOffsetSec + n.tSec, label: n.label ?? n.kind, kind: n.kind,
      })));
    chartHost.append(temperatureChart({
      markerT,
      nodes,
      series: [
        { name: '中心进气 ℃', color: '#e0a860', points: points.map((p) => ({ t: p.t, v: p.centerTemp })) },
        { name: '边缘进气 ℃', color: '#6f95b8', points: points.map((p) => ({ t: p.t, v: p.edgeTemp })) },
        { name: '茶层均温 ℃', color: '#7d9b58', points: points.map((p) => ({ t: p.t, v: p.meanBedTemp })) },
      ],
      onSeek: (t) => seekTo(t),
    }));
  }
  renderChart(0);

  // ---------- 播放控制 ----------
  const playBtn = h('button', {}, '▶ 播放');
  const speedLabel = h('span', { class: 'tag' }, '16×');
  const seek = h('input', {
    class: 'seek', type: 'range', min: '0', max: String(rec.totalDurationSec), step: '10', value: '0',
  }) as HTMLInputElement;
  seek.addEventListener('input', () => seekTo(parseFloat(seek.value)));

  function seekTo(t: number): void {
    if (t < engine.t - 1) restart();
    engine.advance(Math.max(0, t - engine.t));
    syncFrame(true);
  }

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸ 暂停' : '▶ 播放';
    if (playing) {
      lastWall = performance.now();
      loop();
    } else {
      cancelAnimationFrame(raf);
    }
  });

  function loop(): void {
    if (!playing || closed) return;
    const now = performance.now();
    const wallDt = Math.min(0.1, (now - lastWall) / 1000);
    lastWall = now;
    engine.advance(wallDt * SPEEDS[speedIdx]);
    checkTurnAnim();
    syncFrame();
    if (engine.done) {
      playing = false;
      playBtn.textContent = '▶ 播放';
      toast('该记录已仿真到出焙，可点选颗粒追溯，或编辑节点后从头重跑');
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function checkTurnAnim(): void {
    for (const turn of engine.turns) {
      if (!seenTurns.has(turn.atSec) && turn.atSec <= engine.t) {
        seenTurns.add(turn.atSec);
        turnAnim = { start: performance.now(), mix: 0, seed: turn.animSeed, fromT: turn.atSec };
      }
    }
  }

  let lastUiT = -1e9;
  const UI_INTERVAL = 2; // 仿真秒：统计/曲线刷新粒度（3D 仍按 rAF 全帧）

  function syncFrame(forceUi = false): void {
    checkTurnAnim();
    let anim;
    if (turnAnim) {
      turnAnim.mix = Math.min(1, (performance.now() - turnAnim.start) / 700);
      anim = { active: turnAnim.mix < 1, mix: turnAnim.mix, seed: turnAnim.seed };
      if (turnAnim.mix >= 1) turnAnim = null;
    } else {
      anim = { active: false, mix: 1, seed: 0 };
    }
    player.setFrame(adapter.frameAt(), anim);
    player.setFire(engine.fire.firePower, engine.fire.ashCm, engine.fire.phase);
    timeVal.textContent = fmtClock(Math.min(engine.t, rec.totalDurationSec));
    seek.value = String(engine.t);
    // 统计/图表重建成本高，按仿真时间节流；拖动、重跑、翻焙瞬间强制刷新
    const nearTurn = engine.turns.some((tn) => Math.abs(tn.atSec - engine.t) < 1.5);
    if (forceUi || nearTurn || engine.t - lastUiT >= UI_INTERVAL) {
      lastUiT = engine.t;
      renderStats();
      renderChart(engine.t);
    }
  }

  function restart(): void {
    cancelAnimationFrame(raf);
    playing = false;
    playBtn.textContent = '▶ 播放';
    seenTurns.clear();
    turnAnim = null;
    engine = createEngine(rec, batch, basket);
    adapter.setEngine(engine);
    lastUiT = -1e9;
    syncFrame(true);
  }

  // ---------- 颗粒拾取 ----------
  player.onPick((info) => {
    if (!info) return;
    openPelletDrawer({
      pelletId: info.id,
      liveSamples: collectLiveSamples(info.id),
      liveTurns: engine.turns.map((t) => ({ atSec: t.atSec })),
      currentHeat: info.heat,
      currentTemp: info.temp,
      maxTemp: engine.maxTemp[info.id],
      finalScorch: engine.scorch[info.id],
    });
  });

  // 实时模式：直接读引擎内部已采样的历程帧（与落库后同一套数据）
  function collectLiveSamples(id: number): { t: number; temp: number; heat: number }[] {
    const times = engine.historyTimes;
    const temps = engine.historyTempBuffer;
    const heats = engine.historyHeatBuffer;
    const out: { t: number; temp: number; heat: number }[] = [];
    for (let k = 0; k < times.length; k++) {
      const off = k * engine.count + id;
      out.push({ t: times[k], temp: temps[off], heat: heats[off] });
    }
    return out;
  }

  // ---------- 布局 ----------
  const rerunBtn = h('button', { class: 'ghost', onclick: restart }, '↺ 从头重跑');
  const saveResultBtn = h('button', {
    onclick: async () => {
      const engine2 = createEngine(rec, batch, basket);
      const result = engine2.runToEnd();
      rec.resultId = result.id;
      rec.summary = result.summary;
      await repo.results.save(result);
      await repo.records.save(rec);
      toast(`已落库：${result.pelletCount} 颗颗粒、${result.histTimes.length} 帧历程`);
    },
  }, '⏬ 仿真到底并存档');

  const controls = h('div', { class: 'card' },
    h('div', { class: 'playbar' },
      playBtn, rerunBtn, timeVal, seek,
      h('button', {
        class: 'small ghost', onclick: () => {
          speedIdx = (speedIdx + 1) % SPEEDS.length;
          speedLabel.textContent = SPEEDS[speedIdx] + '×';
        },
      }, '倍速'), speedLabel,
    ),
    h('div', { class: 'row' },
      h('button', { class: 'small', onclick: () => addNode('turn') }, '＋ 当前时刻翻焙'),
      h('button', { class: 'small ghost', onclick: () => addNode('pressAsh') }, '＋ 当前时刻压灰'),
      h('div', { class: 'spacer' }),
      saveResultBtn,
    ),
    cutSlider(() => player.scene(), bedDims(batch, basket).thicknessM * 1.2),
  );

  mount(main, h('div', {},
    h('h1', {}, `焙火过程 · ${rec.code}`),
    h('p', { class: 'sub' },
      `${batch.name}｜${basket.name}｜目标 ${rec.targetGrade}｜${rec.pelletCount.toLocaleString()} 颗颗粒实例化渲染`,
      rec.handwrittenNote ? h('div', { class: 'warn', style: 'margin-top:6px' }, '手写记录：' + rec.handwrittenNote) : null,
    ),
    liveStats,
    h('div', { style: 'height:12px' }),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('h2', {}, '三维焙笼（拖拽旋转 / 滚轮缩放 / 点颗粒追溯）'), player.viewport),
      h('div', {},
        h('div', { class: 'card' }, h('h2', {}, '时间轴节点（可编辑）'), nodeList, hwBox),
      ),
    ),
    controls,
    h('div', { class: 'card' }, h('h2', {}, '温度曲线（点击曲线可跳转时间）'), chartHost),
  ));

  syncFrame(true);

  return () => {
    closed = true;
    cancelAnimationFrame(raf);
    player.dispose();
  };
}

function stat(l: string, v: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'v', style: 'font-size:18px' }, v), h('div', { class: 'l' }, l));
}

// 标记仅类型引用，避免未用告警
export type { RoastRecord, TeaBatch, BasketConfig };
