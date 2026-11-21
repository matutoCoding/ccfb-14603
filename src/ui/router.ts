// hash 路由
export type RouteHandler = (params: string[]) => void;

const routes = new Map<string, RouteHandler>();
let notFound: RouteHandler | null = null;

export function registerRoute(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

export function navigate(path: string): void {
  if (location.hash.slice(1) === path) return;
  location.hash = path;
}

function dispatch(): void {
  const raw = location.hash.slice(1) || '/records';
  const parts = raw.split('/').filter(Boolean); // ['roast','record-001']
  const key = '/' + (parts[0] || 'records');
  const handler = routes.get(key) ?? notFound;
  if (handler) handler(parts.slice(1));
}

export function startRouter(on404: RouteHandler): void {
  notFound = on404;
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

export function currentPath(): string {
  return location.hash.slice(1) || '/records';
}
