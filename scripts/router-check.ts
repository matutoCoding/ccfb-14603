// 路由解析单元测试：复刻 router.dispatch 的纯解析部分，覆盖所有 URL 形态
function parseHash(hash: string): { key: string; params: string[] } {
  const raw = hash.slice(1) || '/records';
  const parts = raw.split('/').filter(Boolean);
  return { key: '/' + (parts[0] || 'records'), params: parts.slice(1) };
}

const cases: [string, string, string[]][] = [
  ['#/records', '/records', []],
  ['#/batches', '/batches', []],
  ['#/roast/record-001', '/roast', ['record-001']],
  ['#/roast/record-001/x', '/roast', ['record-001', 'x']],
  ['#/compare', '/compare', []],
  ['', '/records', []],
  ['#/', '/records', []],
  ['#/masters', '/masters', []],
];

let fail = 0;
for (const [hash, expKey, expParams] of cases) {
  const { key, params } = parseHash(hash);
  const ok = key === expKey && JSON.stringify(params) === JSON.stringify(expParams);
  if (!ok) { fail++; console.log(`✗ "${hash}" -> ${key} ${JSON.stringify(params)}，期望 ${expKey} ${JSON.stringify(expParams)}`); }
  else console.log(`✓ "${hash || '(空)'}" -> ${key} ${JSON.stringify(params)}`);
}
if (fail) { console.error(`\n${fail} 条路由用例失败`); process.exit(1); }
console.log('\n路由解析全部通过 ✓');
