// Автоблокировка (docs/ui.md §5.9): 5 минут без ввода. Перезагрузка
// страницы сессию не сбрасывает (app/lib/session-store.js), а закрытие
// вкладки сбрасывает её вместе с памятью вкладки.
//
// Ускорение разрешено только на localhost/127.0.0.1: иначе параметр
// в адресе публичной страницы сократил бы таймер всем.

export const IDLE_MS = 5 * 60 * 1000;
// Скрытая вкладка дольше минуты блокирует хранилище: человек ушёл в другое
// приложение, а вкладка осталась в памяти.
export const HIDDEN_LOCK_MS = 60 * 1000;
const MIN_OVERRIDE_MS = 500;
const MAX_OVERRIDE_MS = 10 * 60 * 1000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.has(String(hostname ?? '').toLowerCase());
}

function readOverride(params, name) {
  const raw = params.get(name);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  if (value < MIN_OVERRIDE_MS || value > MAX_OVERRIDE_MS) return null;
  return value;
}

export function readLockSettings(locationLike) {
  const base = { idleMs: IDLE_MS, overridden: false };
  if (!locationLike || !isLocalHost(locationLike.hostname)) return base;

  let params;
  try {
    params = new URLSearchParams(String(locationLike.search ?? ''));
  } catch {
    return base;
  }
  const idle = readOverride(params, 'idleMs');
  if (idle === null) return base;
  return { idleMs: idle, overridden: true };
}

// state: { now, lastActivity }. Скрытая вкладка не тикает, поэтому срок
// проверяется по Date.now при возвращении (visibilitychange → visible).
export function nextLockReason(state, policy) {
  const { now, lastActivity } = state;
  if (lastActivity !== null && lastActivity !== undefined) {
    if (now - lastActivity >= policy.idleMs) return 'idle';
  }
  return null;
}

// state: { hiddenAt, now, skip }. Пока экран не блокируется (несохранённый
// код восстановления), skip=true: уход со вкладки его не потеряет.
export function hiddenLockReason(state, policy = {}) {
  if (state.skip) return null;
  if (state.hiddenAt === null || state.hiddenAt === undefined) return null;
  const limit = policy.hiddenMs ?? HIDDEN_LOCK_MS;
  return state.now - state.hiddenAt >= limit ? 'hidden' : null;
}
