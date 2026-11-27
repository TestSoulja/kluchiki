// Операции над хранилищем, которыми пользуется интерфейс.
// Здесь нет DOM и нет IndexedDB: та же логика проверяется в node --test
// с подставным адаптером.

import {
  createVault,
  readVault,
  writeVault,
  unlockVault,
  saveVault,
} from '../../src/vault.js';
import {
  addSlot,
  removeSlot,
  createSlot,
  unwrapMasterKey,
  generateRecoveryCode,
  MAX_SLOTS,
} from '../../src/slots.js';
import { randomBytes, bytesEqual } from '../../src/bytes.js';

export { MAX_SLOTS };

export const SLOT_LABELS = Object.freeze({
  password: 'Пароль',
  keyfile: 'Файл-ключ',
  prf: 'Отпечаток',
  recovery: 'Код восстановления',
});

export function parseVault(text) {
  return readVault(text);
}

export async function createVaultWithRecovery(password, { iterations } = {}) {
  const code = generateRecoveryCode();
  const passwordSlot = { kind: 'password', secret: password };
  if (iterations !== undefined) passwordSlot.iterations = iterations;
  const { vault, masterKey } = await createVault({
    slots: [passwordSlot, { kind: 'recovery', secret: code }],
    entries: [],
  });
  return { vault, masterKey, code, text: writeVault(vault) };
}

export function makeSession(vault, masterKey, opened) {
  return {
    masterKey,
    entries: opened.entries.map((entry) => ({ ...entry, tags: [...entry.tags] })),
    slotSetMismatch: opened.slotSetMismatch ?? null,
    slotIds: Array.isArray(opened.slotIds)
      ? [...opened.slotIds]
      : vault.slots.map((slot) => slot.id),
    recoveryConfirmed: Array.isArray(opened.recoveryConfirmed)
      ? [...opened.recoveryConfirmed]
      : [],
  };
}

export async function unlockWith(vault, { kind, secret, slotId }) {
  const opened = await unlockVault(vault, { kind, secret, slotId });
  return {
    masterKey: opened.masterKey,
    entries: opened.body.entries,
    slotSetMismatch: opened.slotSetMismatch,
    slotIds: opened.body.slots,
    recoveryConfirmed: opened.body.recoveryConfirmed ?? [],
    slot: opened.slot,
  };
}

// Сверка текущего заголовка с набором, который помнит расшифрованное тело.
export function compareSlotSets(vault, slotIds) {
  const actual = new Set(vault.slots.map((slot) => slot.id));
  const stored = new Set(slotIds);
  const missing = [...stored].filter((id) => !actual.has(id)).sort();
  const extra = [...actual].filter((id) => !stored.has(id)).sort();
  if (missing.length === 0 && extra.length === 0) return null;
  return { missing, extra };
}

export async function saveEntries(
  vault,
  masterKey,
  entries,
  { acceptSlotSet = false, recoveryConfirmed } = {},
) {
  const next = await saveVault(vault, masterKey, entries, {
    acceptSlotSet,
    recoveryConfirmed,
  });
  return { vault: next, text: writeVault(next) };
}

export async function addPasswordSlot(vault, masterKey, password) {
  return addSlot(vault, { kind: 'password', secret: password }, masterKey);
}

export async function addKeyfileSlot(vault, masterKey) {
  const key = randomBytes(32);
  const next = await addSlot(vault, { kind: 'keyfile', secret: key }, masterKey);
  return { vault: next, key };
}

export async function addRecoverySlot(vault, masterKey) {
  const code = generateRecoveryCode();
  const next = await addSlot(vault, { kind: 'recovery', secret: code }, masterKey);
  return { vault: next, code };
}

export function removeSlotFrom(vault, id) {
  return removeSlot(vault, id);
}

export async function changeMasterPassword(vault, masterKey, current, next) {
  const slot = vault.slots.find((candidate) => candidate.kind === 'password');
  if (!slot) throw new Error('слота пароля нет');
  let unwrapped;
  try {
    unwrapped = await unwrapMasterKey(slot, current);
  } catch {
    throw new Error('не удалось расшифровать: пароль не подходит или файл изменён');
  }
  const same = bytesEqual(unwrapped, masterKey);
  unwrapped.fill(0);
  if (!same) {
    throw new Error('не удалось расшифровать: пароль не подходит или файл изменён');
  }
  const fresh = await createSlot({
    kind: 'password',
    secret: next,
    masterKey,
    id: slot.id,
  });
  return {
    ...vault,
    slots: vault.slots.map((candidate) =>
      candidate.id === slot.id ? fresh : candidate,
    ),
  };
}

export function parseTags(text) {
  return String(text ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

export function titleError(title) {
  const value = String(title ?? '').trim();
  if (value === '') return 'заголовок нужен: по нему ищут запись';
  if ([...value].length > 200) return 'заголовок длиннее 200 символов';
  return null;
}

function fieldsOf(fields) {
  return {
    title: String(fields.title ?? '').trim(),
    login: String(fields.login ?? ''),
    password: String(fields.password ?? ''),
    url: String(fields.url ?? ''),
    notes: String(fields.notes ?? ''),
    tags: Array.isArray(fields.tags) ? fields.tags : parseTags(fields.tags),
  };
}

export function makeEntry(fields, nowIso = new Date().toISOString()) {
  const error = titleError(fields.title);
  if (error) throw new Error(error);
  return {
    id: globalThis.crypto.randomUUID(),
    ...fieldsOf(fields),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function updateEntry(entry, fields, nowIso = new Date().toISOString()) {
  const error = titleError(fields.title);
  if (error) throw new Error(error);
  return {
    ...entry,
    ...fieldsOf(fields),
    updatedAt: nowIso,
  };
}

// Затирает ключ и расшифрованные записи. Ссылки после этого не держат
// ни MK, ни открытых данных.
export function lockSession(session) {
  if (!session) return null;
  if (session.masterKey && typeof session.masterKey.fill === 'function') {
    session.masterKey.fill(0);
  }
  session.masterKey = null;
  session.entries = [];
  session.slotIds = [];
  session.slotSetMismatch = null;
  return null;
}
