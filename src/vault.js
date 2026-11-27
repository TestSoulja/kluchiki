// Хранилище kluchiki.vault: сборка, разбор, проверки версий и полей.
//
// Формат — docs/format.md. Тело шифруется отдельно от слотов; AAD тела —
// КJSON {cipher, format, version}, AAD слота — КJSON слота без wrap.
// В v1 неизвестное поле в заголовке, теле или слоте — отказ: молча
// отбрасывать поля нельзя, иначе потеря при перезаписи.

import {
  assertBytes,
  randomBytes,
  toBase64url,
  fromBase64url,
  utf8Decode,
} from './bytes.js';
import { canonicalBytes } from './canonical.js';
import { aesGcmEncrypt, aesGcmDecrypt, IV_BYTES, TAG_BYTES } from './aead.js';
import {
  createSlot,
  unwrapMasterKey,
  prfDescriptor,
  MAX_SLOTS,
  SLOT_KINDS,
  MIN_ITERATIONS,
  MAX_ITERATIONS,
  PASSWORD_SALT_BYTES,
  HKDF_SALT_BYTES,
  SLOT_ID_BYTES,
  MK_BYTES,
  KDF_NAME,
  HKDF_INFO,
} from './slots.js';

export const FORMAT = 'kluchiki.vault';
export const BODY_FORMAT = 'kluchiki.body';
export const VERSION = 1;
export const CIPHER = Object.freeze({
  name: 'AES-256-GCM',
  ivBytes: IV_BYTES,
  tagBytes: TAG_BYTES,
});

const TOP_KEYS = ['format', 'version', 'cipher', 'body', 'slots'];
const CIPHER_KEYS = ['name', 'ivBytes', 'tagBytes'];
const BODY_KEYS = ['iv', 'ct', 'tag'];
const BODY_FIELDS = ['format', 'version', 'slots', 'entries'];
const BODY_OPTIONAL_FIELDS = ['recoveryConfirmed'];
const SLOT_KEYS = ['version', 'id', 'kind', 'kdf', 'wrap'];
const PASSWORD_KDF_KEYS = ['name', 'iterations', 'salt'];
const HKDF_KDF_KEYS = ['name', 'salt', 'info'];
const ENTRY_KEYS = [
  'id',
  'title',
  'login',
  'password',
  'url',
  'notes',
  'tags',
  'createdAt',
  'updatedAt',
];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function checkKeys(object, required, optional, where) {
  if (!isPlainObject(object)) throw new TypeError(`${where}: ожидался объект`);
  for (const key of Object.keys(object)) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new Error(`${where}: неизвестное поле ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in object)) throw new Error(`${where}: нет поля ${key}`);
  }
}

function checkExactKeys(object, allowed, where) {
  checkKeys(object, allowed, [], where);
}

function decodeB64(value, name, expectedLength) {
  const bytes = fromBase64url(value, name);
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${name}: нужно ${expectedLength} байт, получено ${bytes.length}`);
  }
  return bytes;
}

function validateSlotIdList(list, where) {
  if (!Array.isArray(list)) throw new TypeError(`${where}: slots должен быть массивом`);
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    if (typeof id !== 'string') {
      throw new Error(`${where}: slots[${i}] должен быть строкой`);
    }
    decodeB64(id, `${where}: slots[${i}]`, SLOT_ID_BYTES);
    if (i > 0 && !(list[i - 1] < id)) {
      throw new Error(`${where}: slots должны быть по возрастанию и без повторов`);
    }
  }
  return list;
}

function slotIdsForBody(slots) {
  return slots.map((slot) => slot.id).sort();
}

// Отметка «код записан»: необязательный список id слотов recovery.
// Отсутствие поля означает пустой список; писатель пустой не пишет.
function validateRecoveryConfirmed(list, slotIds) {
  if (!Array.isArray(list)) {
    throw new TypeError('тело: recoveryConfirmed должен быть массивом');
  }
  const known = new Set(slotIds);
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    if (typeof id !== 'string') {
      throw new Error(`тело: recoveryConfirmed[${i}] должен быть строкой`);
    }
    decodeB64(id, `тело: recoveryConfirmed[${i}]`, SLOT_ID_BYTES);
    if (i > 0 && !(list[i - 1] < id)) {
      throw new Error(
        'тело: recoveryConfirmed должны быть по возрастанию и без повторов',
      );
    }
    if (!known.has(id)) {
      throw new Error(`тело: recoveryConfirmed[${i}] нет среди slots`);
    }
  }
}

function confirmedForSave(list, slotIds) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    throw new TypeError('сохранение: recoveryConfirmed должен быть массивом');
  }
  const allowed = new Set(slotIds);
  const kept = [];
  for (const id of list) {
    if (typeof id !== 'string') {
      throw new Error('сохранение: recoveryConfirmed должен состоять из строк');
    }
    if (allowed.has(id) && !kept.includes(id)) kept.push(id);
  }
  return kept.sort();
}

// missing — id, которые помнит тело, но которых нет в заголовке;
// extra — id, которые есть в заголовке, но не попали в тело.
function compareSlotSets(slots, bodySlots) {
  const actual = new Set(slots.map((slot) => slot.id));
  const stored = new Set(bodySlots);
  const missing = [...stored].filter((id) => !actual.has(id)).sort();
  const extra = [...actual].filter((id) => !stored.has(id)).sort();
  if (missing.length === 0 && extra.length === 0) return null;
  return { missing, extra };
}

function validateCipher(cipher) {
  checkExactKeys(cipher, CIPHER_KEYS, 'cipher');
  if (cipher.name !== CIPHER.name) throw new Error(`cipher: имя должно быть ${CIPHER.name}`);
  if (cipher.ivBytes !== CIPHER.ivBytes) {
    throw new Error(`cipher: ivBytes должно быть ${CIPHER.ivBytes}`);
  }
  if (cipher.tagBytes !== CIPHER.tagBytes) {
    throw new Error(`cipher: tagBytes должно быть ${CIPHER.tagBytes}`);
  }
}

function validateBodyCiphertext(body) {
  checkExactKeys(body, BODY_KEYS, 'body');
  const iv = decodeB64(body.iv, 'body.iv', IV_BYTES);
  const ct = decodeB64(body.ct, 'body.ct');
  const tag = decodeB64(body.tag, 'body.tag', TAG_BYTES);
  return { iv, ct, tag };
}

function validateWrap(wrap) {
  checkExactKeys(wrap, BODY_KEYS, 'слот: wrap');
  const iv = decodeB64(wrap.iv, 'слот: wrap.iv', IV_BYTES);
  const ct = decodeB64(wrap.ct, 'слот: wrap.ct', MK_BYTES);
  const tag = decodeB64(wrap.tag, 'слот: wrap.tag', TAG_BYTES);
  return { iv, ct, tag };
}

function validateKdf(kind, kdf, allowWeakKdf) {
  if (kind === 'password') {
    checkExactKeys(kdf, PASSWORD_KDF_KEYS, 'слот: kdf');
    if (kdf.name !== KDF_NAME.password) {
      throw new Error(`слот: для password нужен ${KDF_NAME.password}`);
    }
    if (!Number.isSafeInteger(kdf.iterations)) {
      throw new Error('слот: iterations должно быть целым');
    }
    const minimum = allowWeakKdf ? 1 : MIN_ITERATIONS;
    if (kdf.iterations < minimum || kdf.iterations > MAX_ITERATIONS) {
      throw new RangeError(
        `слот: iterations должно быть от ${minimum} до ${MAX_ITERATIONS}`,
      );
    }
    decodeB64(kdf.salt, 'слот: salt', PASSWORD_SALT_BYTES);
    return;
  }

  checkExactKeys(kdf, HKDF_KDF_KEYS, 'слот: kdf');
  if (kdf.name !== KDF_NAME[kind]) {
    throw new Error(`слот: для ${kind} нужен ${KDF_NAME[kind]}`);
  }
  if (kdf.info !== HKDF_INFO[kind]) {
    throw new Error(`слот: info для ${kind} не совпадает`);
  }
  decodeB64(kdf.salt, 'слот: salt', HKDF_SALT_BYTES);
}

function validateSlot(slot, index, { allowUnknownVersion, allowWeakKdf }) {
  const where = `слот ${index}`;
  if (!isPlainObject(slot)) throw new TypeError(`${where}: ожидался объект`);
  if (!Number.isSafeInteger(slot.version)) {
    throw new Error(`${where}: version должно быть целым`);
  }
  if (slot.version > VERSION) {
    if (!allowUnknownVersion) {
      throw new Error(`${where}: версия ${slot.version} не поддерживается для записи`);
    }
    // Незнакомый слот читается как непрозрачный: нужны id и kind,
    // чтобы показать «недоступен здесь». Остальное не проверяем.
    if (typeof slot.id !== 'string') throw new Error(`${where}: id должен быть строкой`);
    decodeB64(slot.id, `${where}: id`, SLOT_ID_BYTES);
    if (typeof slot.kind !== 'string' || slot.kind.length === 0) {
      throw new Error(`${where}: kind должен быть непустой строкой`);
    }
    return { id: slot.id, supported: false };
  }
  if (slot.version !== VERSION) {
    throw new Error(`${where}: неизвестная версия ${slot.version}`);
  }
  if (!SLOT_KINDS.includes(slot.kind)) {
    throw new Error(`${where}: неизвестный вид ${JSON.stringify(slot.kind)}`);
  }

  const allowed = slot.kind === 'prf' ? [...SLOT_KEYS, 'prf'] : SLOT_KEYS;
  checkExactKeys(slot, allowed, where);
  decodeB64(slot.id, `${where}: id`, SLOT_ID_BYTES);
  validateKdf(slot.kind, slot.kdf, allowWeakKdf);
  validateWrap(slot.wrap);
  if (slot.kind === 'prf') prfDescriptor(slot.prf);
  return { id: slot.id, supported: true };
}

function validateEntry(entry, index) {
  const where = `запись ${index}`;
  checkExactKeys(entry, ENTRY_KEYS, where);
  for (const key of [
    'id',
    'title',
    'login',
    'password',
    'url',
    'notes',
    'createdAt',
    'updatedAt',
  ]) {
    if (typeof entry[key] !== 'string') throw new Error(`${where}: ${key} должен быть строкой`);
  }
  if (entry.id.length === 0) throw new Error(`${where}: id не может быть пустым`);
  if (!Array.isArray(entry.tags)) throw new Error(`${where}: tags должен быть массивом`);
  for (const tag of entry.tags) {
    if (typeof tag !== 'string') throw new Error(`${where}: tags должны быть строками`);
  }
}

function validateEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError('тело: entries должен быть массивом');
  const ids = new Set();
  for (let i = 0; i < entries.length; i++) {
    validateEntry(entries[i], i);
    if (ids.has(entries[i].id)) throw new Error(`тело: повторяется id записи ${entries[i].id}`);
    ids.add(entries[i].id);
  }
}

function validateBody(body) {
  checkKeys(body, BODY_FIELDS, BODY_OPTIONAL_FIELDS, 'тело');
  if (body.format !== BODY_FORMAT) throw new Error(`тело: format должен быть ${BODY_FORMAT}`);
  if (body.version !== VERSION) throw new Error(`тело: version ${body.version} не поддерживается`);
  const slotIds = validateSlotIdList(body.slots, 'тело');
  validateEntries(body.entries);
  if ('recoveryConfirmed' in body) {
    validateRecoveryConfirmed(body.recoveryConfirmed, slotIds);
  }
}

function cloneEntries(entries) {
  validateEntries(entries);
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    login: entry.login,
    password: entry.password,
    url: entry.url,
    notes: entry.notes,
    tags: [...entry.tags],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }));
}

export function validateVault(vault, options = {}) {
  const allowUnknownVersion = options.allowUnknownVersion === true;
  const allowWeakKdf = options.allowWeakKdf === true;
  checkExactKeys(vault, TOP_KEYS, 'файл');
  if (vault.format !== FORMAT) throw new Error(`файл: format должен быть ${FORMAT}`);
  if (vault.version !== VERSION) {
    if (Number.isSafeInteger(vault.version) && vault.version > VERSION) {
      throw new Error(`файл: версия ${vault.version} не поддерживается`);
    }
    throw new Error(`файл: version должен быть ${VERSION}`);
  }
  validateCipher(vault.cipher);
  validateBodyCiphertext(vault.body);
  if (!Array.isArray(vault.slots)) throw new TypeError('файл: slots должен быть массивом');
  if (vault.slots.length < 1 || vault.slots.length > MAX_SLOTS) {
    throw new Error(`файл: слотов должно быть от 1 до ${MAX_SLOTS}`);
  }
  const ids = new Set();
  for (let i = 0; i < vault.slots.length; i++) {
    const { id } = validateSlot(vault.slots[i], i, { allowUnknownVersion, allowWeakKdf });
    if (ids.has(id)) throw new Error(`файл: повторяется id слота ${id}`);
    ids.add(id);
  }
  return vault;
}

export function bodyAadBytes(vault) {
  return canonicalBytes({
    cipher: vault.cipher,
    format: vault.format,
    version: vault.version,
  });
}

function assertMasterKey(masterKey) {
  assertBytes(masterKey, 'хранилище: MK');
  if (masterKey.length !== MK_BYTES) {
    throw new RangeError(`хранилище: MK должен быть ${MK_BYTES} байт`);
  }
}

async function sealBody(vault, masterKey, body, bodyIv) {
  assertMasterKey(masterKey);
  validateBody(body);
  const sealed = await aesGcmEncrypt(
    masterKey,
    canonicalBytes(body),
    bodyAadBytes(vault),
    bodyIv,
  );
  return {
    iv: toBase64url(sealed.iv),
    ct: toBase64url(sealed.ct),
    tag: toBase64url(sealed.tag),
  };
}

function parseBody(plaintext) {
  let text;
  try {
    text = utf8Decode(plaintext);
  } catch {
    throw new Error('тело: не UTF-8');
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('тело: не JSON');
  }
  validateBody(body);
  return body;
}

export async function createVault({
  slots,
  entries = [],
  masterKey,
  bodyIv,
  allowWeakKdf = false,
}) {
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > MAX_SLOTS) {
    throw new Error(`createVault: слотов должно быть от 1 до ${MAX_SLOTS}`);
  }
  const mk = masterKey === undefined ? randomBytes(MK_BYTES) : masterKey;
  assertMasterKey(mk);

  const vault = {
    format: FORMAT,
    version: VERSION,
    cipher: {
      name: CIPHER.name,
      ivBytes: CIPHER.ivBytes,
      tagBytes: CIPHER.tagBytes,
    },
    body: { iv: '', ct: '', tag: '' },
    slots: [],
  };

  for (const spec of slots) {
    if (!isPlainObject(spec)) throw new TypeError('createVault: слот должен быть объектом');
    const slot = await createSlot({
      kind: spec.kind,
      secret: spec.secret,
      prf: spec.prf,
      masterKey: mk,
      id: spec.id,
      salt: spec.salt,
      iv: spec.iv,
      iterations: spec.iterations,
      allowWeakKdf,
    });
    if (vault.slots.some((existing) => existing.id === slot.id)) {
      throw new Error(`createVault: повторяется id слота ${slot.id}`);
    }
    vault.slots.push(slot);
  }

  const body = {
    format: BODY_FORMAT,
    version: VERSION,
    slots: slotIdsForBody(vault.slots),
    entries: cloneEntries(entries),
  };
  vault.body = await sealBody(vault, mk, body, bodyIv);
  validateVault(vault, { allowUnknownVersion: false, allowWeakKdf });
  return { vault, masterKey: mk };
}

export function readVault(text, { allowWeakKdf = false } = {}) {
  if (typeof text !== 'string') throw new TypeError('readVault: ожидалась строка');
  if (text.charCodeAt(0) === 0xfeff) throw new Error('файл: UTF-8 BOM запрещён');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`файл: не JSON (${error.message})`);
  }
  validateVault(parsed, { allowUnknownVersion: true, allowWeakKdf });
  return parsed;
}

export function writeVault(vault, { allowWeakKdf = false } = {}) {
  validateVault(vault, { allowUnknownVersion: false, allowWeakKdf });
  // Форматирование не часть формата; выбрано одно и то же для всех
  // записей, чтобы вектор §8.4 можно было сверить байт в байт.
  return JSON.stringify(vault, null, 2);
}

export async function unlockVault(
  vault,
  { slotId, kind, secret, allowWeakKdf = false },
) {
  validateVault(vault, { allowUnknownVersion: true, allowWeakKdf });

  let candidates;
  if (slotId !== undefined) {
    const id = typeof slotId === 'string' ? slotId : toBase64url(slotId);
    const slot = vault.slots.find((candidate) => candidate.id === id);
    if (!slot) throw new Error('разблокировка: слот не найден');
    if (slot.version !== VERSION) {
      throw new Error(`разблокировка: версия слота ${slot.version} не поддерживается`);
    }
    candidates = [slot];
  } else if (kind !== undefined) {
    if (!SLOT_KINDS.includes(kind)) {
      throw new Error(`разблокировка: неизвестный вид ${JSON.stringify(kind)}`);
    }
    candidates = vault.slots.filter(
      (candidate) => candidate.version === VERSION && candidate.kind === kind,
    );
    if (candidates.length === 0) {
      throw new Error(`разблокировка: нет слота ${kind}`);
    }
  } else {
    throw new Error('разблокировка: укажите slotId или kind');
  }

  let opened = null;
  for (const slot of candidates) {
    try {
      const masterKey = await unwrapMasterKey(slot, secret, { allowWeakKdf });
      opened = { slot, masterKey };
      break;
    } catch {
      // Неверный секрет или повреждённая обёртка: пробуем следующий слот.
    }
  }
  if (opened === null) {
    throw new Error('разблокировка: неверный секрет или повреждённый слот');
  }

  const bodyCt = validateBodyCiphertext(vault.body);
  let plaintext;
  try {
    plaintext = await aesGcmDecrypt(
      opened.masterKey,
      bodyCt.iv,
      bodyCt.ct,
      bodyCt.tag,
      bodyAadBytes(vault),
    );
  } catch {
    opened.masterKey.fill(0);
    throw new Error('разблокировка: тело не расшифровалось (файл изменён?)');
  }

  const body = parseBody(plaintext);
  return {
    masterKey: opened.masterKey,
    body,
    slot: opened.slot,
    slotSetMismatch: compareSlotSets(vault.slots, body.slots),
  };
}

// Тело по уже известному MK: так восстанавливается сессия вкладки после
// перезагрузки, когда слот заново не разблокируют. Формат не меняется.
export async function openBodyWithMasterKey(
  vault,
  masterKey,
  { allowWeakKdf = false } = {},
) {
  validateVault(vault, { allowUnknownVersion: false, allowWeakKdf });
  assertMasterKey(masterKey);
  const bodyCt = validateBodyCiphertext(vault.body);
  let plaintext;
  try {
    plaintext = await aesGcmDecrypt(
      masterKey,
      bodyCt.iv,
      bodyCt.ct,
      bodyCt.tag,
      bodyAadBytes(vault),
    );
  } catch {
    throw new Error('разблокировка: тело не расшифровалось (файл изменён?)');
  }
  return parseBody(plaintext);
}

export async function saveVault(
  vault,
  masterKey,
  entries,
  { bodyIv, allowWeakKdf = false, acceptSlotSet = false, recoveryConfirmed } = {},
) {
  validateVault(vault, { allowUnknownVersion: false, allowWeakKdf });
  assertMasterKey(masterKey);

  // Текущее тело — источник прежнего набора слотов. Без его расшифровки
  // нельзя отличить обычное сохранение от подмены заголовка, поэтому
  // читаем тело до записи. AAD тела от набора слотов не зависит, так что
  // удаление слота из заголовка этой проверке не мешает.
  const bodyCt = validateBodyCiphertext(vault.body);
  let plaintext;
  try {
    plaintext = await aesGcmDecrypt(
      masterKey,
      bodyCt.iv,
      bodyCt.ct,
      bodyCt.tag,
      bodyAadBytes(vault),
    );
  } catch {
    throw new Error('сохранение: текущее тело не расшифровалось (файл изменён?)');
  }
  const previousBody = parseBody(plaintext);

  const mismatch = compareSlotSets(vault.slots, previousBody.slots);
  if (mismatch !== null && !acceptSlotSet) {
    throw new Error(
      `сохранение: набор слотов расходится с телом (missing: ${
        mismatch.missing.join(', ') || '—'
      }; extra: ${mismatch.extra.join(', ') || '—'}); передайте acceptSlotSet: true`,
    );
  }

  // §6: новый IV на каждое сохранение. Случайное совпадение с прежним
  // (2^-96) отбрасываем и берём ещё раз.
  let iv = bodyIv;
  if (iv === undefined) {
    do {
      iv = randomBytes(IV_BYTES);
    } while (toBase64url(iv) === vault.body.iv);
  }

  const slotIds = slotIdsForBody(vault.slots);
  const confirmed = confirmedForSave(
    recoveryConfirmed === undefined ? previousBody.recoveryConfirmed : recoveryConfirmed,
    slotIds,
  );
  const body = {
    format: BODY_FORMAT,
    version: VERSION,
    slots: slotIds,
    entries: cloneEntries(entries),
  };
  if (confirmed.length > 0) body.recoveryConfirmed = confirmed;
  const sealed = await sealBody(vault, masterKey, body, iv);
  return { ...vault, body: sealed };
}
