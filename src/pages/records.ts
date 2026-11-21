// 焙火记录总列表（入口页，跳转焙火过程）
import { h, mount, toast, fmtTime, gradeTag, num } from '../ui/dom';
import { repo } from '../data/repo';
import { navigate } from '../ui/router';

export async function recordsListPage(main: HTMLElement): Promise<void> {
  const [records, batches, masters] = await Promise.all([
    repo.records.all(), repo.batches.all(), repo.masters.all(),
  ]);
  mount(main, h('div', {},
    h('h1', {}, '焙火记录'),
    h('p', { class: 'sub' }, '所有批次的焙火档案；点击「进入三维焙火」可实时仿真、编辑节点、追溯单颗粒历程。'),
    h('div', { class: 'card' },
      records.length === 0 ? h('div', { class: 'empty' }, '暂无记录') : h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '编号'), h('th', {}, '毛茶批次'), h('th', {}, '师傅'), h('th', {}, '目标档'),
          h('th', {}, '总时长'), h('th', {}, '翻焙'), h('th', {}, '实际档/均值'), h('th', {}, '均匀度'),
          h('th', {}, '焦斑/底焦'), h('th', {}, '状态'), h('th', {}, '操作'),
        )),
        h('tbody', {}, ...records.map((r) => {
          const b = batches.find((x) => x.id === r.batchId);
          const m = masters.find((x) => x.id === r.masterId);
          const s = r.summary;
          return h('tr', {},
            h('td', { class: 'mono' }, r.code),
            h('td', {}, b?.name ?? r.batchId),
            h('td', {}, m?.name ?? '—'),
            h('td', {}, gradeTag(r.targetGrade)),
            h('td', {}, fmtTime(r.totalDurationSec)),
            h('td', { class: 'num' }, String(r.sessions.reduce((n, ses) => n + ses.nodes.filter((x) => x.kind === 'turn').length, 0))),
            s ? h('td', {}, gradeTag(s.grade), ' ', h('span', { class: 'mono muted' }, num(s.meanHeat, 2)))
              : h('td', { class: 'muted' }, '未仿真'),
            s ? h('td', { class: 'num' }, num(s.uniformPct, 1) + '%') : h('td'),
            s ? h('td', { class: 'num' }, `${num(s.scorchPct, 1)}% / ${num(s.bottomScorchPct, 1)}%`) : h('td'),
            h('td', {}, s ? h('span', { class: 'tag good' }, '已落库') : h('span', { class: 'tag' }, '待仿真')),
            h('td', {},
              h('button', { class: 'small', onclick: () => navigate('/roast/' + r.id) }, '进入三维焙火'),
              h('button', {
                class: 'small ghost', style: 'margin-left:6px',
                onclick: async () => {
                  if (!confirm(`删除记录 ${r.code} 及其仿真结果？`)) return;
                  await repo.records.remove(r.id);
                  toast('已删除');
                  recordsListPage(main);
                },
              }, '删除'),
            ),
          );
        })),
      ),
    ),
  ));
}
