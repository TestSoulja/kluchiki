// Сессия вкладки: MK и служебные поля живут в sessionStorage, не в
// постоянном хранилище браузера. Записи (entries) сюда не попадают — они
// читаются из IndexedDB при восстановлении. Формат хранилища не меняется.
//
// sessionStorage умирает вместе с вкладкой, поэтому закрытие приложения
// разлогинивает, а перезагрузка страницы — нет, пока не истёк IDLE_MS.

import { fromBase64url, toBase64url } from '../../src/bytes.js';

export const SESSION_KEY = 'kluchiki.session';

// Единственное место в приложении, где открывается доступ к хранилищу
// вкладки: страж падает, если sessionStorage появится в другом файле app/.
export function browserStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// Экраны, которые можно открыть без props после перезагрузки. Карточка без
// entryId сама уводит в список; экран кода не восстанавливается — кода в
// памяти нет.
const RESTORED_SCREENS = new Set([
  'list',
  'slots',
  'card',
  'generator',
  'transfer',
  'erase',
]);

export function restoreScreen(name) {
  return RESTORED_SCREENS.has(name) ? name : 'list';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMismatch(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'object' &&
      isStringArray(value.missing) &&
      isStringArray(value.extra))
  );
}

export function decodeSession(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Number.isFinite(data.lastActivity) || data.lastActivity <= 0) return null;
  if (!isStringArray(data.slotIds)) return null;
  if (!isStringArray(data.recoveryConfirmed)) return null;
  if (!isMismatch(data.slotSetMismatch)) return null;
  let masterKey;
  try {
    masterKey = fromBase64url(data.masterKey, 'сессия: MK');
  } catch {
    return null;
  }
  if (masterKey.length !== 32) {
    masterKey.fill(0);
    return null;
  }
  return {
    masterKey,
    slotIds: [...data.slotIds],
    lastActivity: data.lastActivity,
    recoveryConfirmed: [...data.recoveryConfirmed],
    recoveryConfirmedFromSetting: data.recoveryConfirmedFromSetting === true,
    slotSetMismatch: data.slotSetMismatch ?? null,
    screen: typeof data.screen === 'string' ? data.screen : 'list',
  };
}

export function encodeSession(state) {
  return JSON.stringify({
    masterKey: toBase64url(state.masterKey),
    slotIds: state.slotIds,
    lastActivity: state.lastActivity,
    recoveryConfirmed: state.recoveryConfirmed,
    recoveryConfirmedFromSetting: state.recoveryConfirmedFromSetting === true,
    slotSetMismatch: state.slotSetMismatch ?? null,
    screen: state.screen,
  });
}

export function readSession(storage) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  return decodeSession(raw);
}

export function writeSession(storage, state) {
  if (!storage) return false;
  try {
    storage.setItem(SESSION_KEY, encodeSession(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(storage) {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // Приватный режим: записи и так нет.
  }
}

// Восстановление: свежая запись + ключ, который открывает тело.
//   { kind: 'ok', entry, body } | { kind: 'none' } |
//   { kind: 'expired' } | { kind: 'stale' }
// expired/stale стирают запись; ключ в памяти обнуляется.
export async function restoreSession({
  storage,
  vault,
  now,
  idleMs,
  decryptBody,
}) {
  const entry = readSession(storage);
  if (!entry) {
    clearSession(storage);
    return { kind: 'none' };
  }
  if (!(now - entry.lastActivity < idleMs)) {
    entry.masterKey.fill(0);
    clearSession(storage);
    return { kind: 'expired' };
  }
  let body;
  try {
    body = await decryptBody(vault, entry.masterKey);
  } catch {
    entry.masterKey.fill(0);
    clearSession(storage);
    return { kind: 'stale' };
  }
  return { kind: 'ok', entry, body };
}
