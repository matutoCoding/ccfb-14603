// 应用入口：导航外壳 + hash 路由 + 首启种子数据
import './styles.css';
import { h } from './ui/dom';
import { startRouter, navigate, currentPath } from './ui/router';
import { batchesPage } from './pages/batches';
import { basketsPage } from './pages/baskets';
import { recordsListPage } from './pages/records';
import { roastPage } from './pages/roast';
import { comparePage } from './pages/compare';
import { mastersPage } from './pages/masters';
import { repo } from './data/repo';
import { buildAndStoreSeeds } from './data/seed';

const NAV = [
  { path: '/batches', ico: '🍃', label: '毛茶批次' },
  { path: '/baskets', ico: '🏺', label: '焙笼配置' },
  { path: '/records', ico: '📒', label: '焙火记录' },
  { path: '/roast', ico: '🔥', label: '焙火过程' },
  { path: '/compare', ico: '⚖️', label: '成茶对比' },
  { path: '/masters', ico: '👤', label: '师傅档案' },
];

let disposer: (() => void) | undefined;

function shell(): void {
  const app = document.querySelector('#app')!;
  const main = h('main');
  const nav = h('nav', { class: 'side' },
    h('div', { class: 'brand' }, '炭焙复现', h('small', {}, '三维 · 逐颗粒 · 可追溯')),
    ...NAV.map((n) =>
      h('a', {
        href: '#' + n.path,
        class: currentPath().startsWith(n.path) ? 'active' : '',
      }, h('span', { class: 'nav-ico' }, n.ico), n.label),
    ),
  );
  app.innerHTML = '';
  app.append(nav, main);
}

function refreshActiveNav(): void {
  document.querySelectorAll('nav.side a').forEach((a) => {
    const href = a.getAttribute('href')!.slice(1);
    a.classList.toggle('active', currentPath().startsWith(href) && !(href === '/records' && currentPath().startsWith('/roast')));
  });
}

async function bootstrap(): Promise<void> {
  // 首次启动：生成测试批次、三位师傅、四条焙火记录并跑完整仿真
  const existing = await repo.records.all();
  if (existing.length === 0) {
    const loading = document.querySelector('#app')!;
    loading.innerHTML = '<div style="padding:60px;color:#c8853c;font-family:sans-serif">正在生成种子数据并对 4 条记录 × 5000 颗茶跑炭焙仿真…</div>';
    await buildAndStoreSeeds();
  }
  shell();

  startRouter(async (params) => {
    disposer?.();
    disposer = undefined;
    refreshActiveNav();
    const main = document.querySelector('main') as HTMLElement;
    const section = params[0] ?? 'records';
    switch ('/' + section) {
      case '/batches': await batchesPage(main); break;
      case '/baskets': await basketsPage(main); break;
      case '/records': await recordsListPage(main); break;
      case '/roast': {
        const d = await roastPage(main, params.slice(1));
        if (typeof d === 'function') disposer = d;
        break;
      }
      case '/compare': await comparePage(main); break;
      case '/masters': await mastersPage(main); break;
      default: await recordsListPage(main);
    }
    refreshActiveNav();
  });
}

bootstrap().catch((err) => {
  console.error(err);
  document.querySelector('#app')!.innerHTML =
    `<pre style="color:#e88;padding:30px;white-space:pre-wrap">启动失败：${String(err?.stack ?? err)}</pre>`;
});
