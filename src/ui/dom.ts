// 极简 DOM 构建工具
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as (e: Event) => void);
    } else if (k === 'value') {
      (el as HTMLInputElement).value = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.innerHTML = '';
}

export function mount(el: HTMLElement, node: Node): void {
  clear(el);
  el.append(node);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2600): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export function fmtTime(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400);
  const hh = Math.floor((sec % 86400) / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天${hh}时${mm}分`;
  if (hh > 0) return `${hh}时${mm}分`;
  return `${mm}分`;
}

export function fmtClock(sec: number): string {
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function gradeTag(grade: string, extra?: string): HTMLElement {
  const cls = grade === '轻火' ? 'light' : grade === '中火' ? 'medium' : 'strong';
  return h('span', { class: `tag ${cls}` }, extra ? `${grade} ${extra}` : grade);
}

export function num(v: number, digits = 2): string {
  return v.toFixed(digits);
}
