// Слоты хранилища: password / keyfile / prf / recovery.
//
// Слот хранит не ключ, а MK, зашифрованный KEK. KEK выводится из секрета
// слота; AAD слота — КJSON слота без поля wrap (format.md §5).
// Удалить последний слот нельзя: иначе файл останется, а открыть его нечем.

import {
  assertBytes,
  randomBytes,
  toBase64url,
  fromBase64url,
  utf8,
} from './bytes.js';
import { canonicalBytes } from './canonical.js';
import { pbkdf2Sha256, hkdfSha256, sha256, secretToBytes } from './kdf.js';
import { aesGcmEncrypt, aesGcmDecrypt, IV_BYTES } from './aead.js';

export const SLOT_VERSION = 1;
export const MAX_SLOTS = 8;
export const MIN_ITERATIONS = 100000;
export const MAX_ITERATIONS = 5000000;
export const DEFAULT_ITERATIONS = 600000;
export const PASSWORD_SALT_BYTES = 16;
export const HKDF_SALT_BYTES = 32;
export const SLOT_ID_BYTES = 8;
export const RECOVERY_BYTES = 20;
export const MK_BYTES = 32;

export const SLOT_KINDS = Object.freeze(['password', 'keyfile', 'prf', 'recovery']);

export const KDF_NAME = Object.freeze({
  password: 'PBKDF2-HMAC-SHA256',
  keyfile: 'HKDF-SHA256',
  prf: 'HKDF-SHA256',
  recovery: 'HKDF-SHA256',
});

export const HKDF_INFO = Object.freeze({
  keyfile: 'kluchiki.vault.keyfile.v1',
  prf: 'kluchiki.vault.prf.v1',
  recovery: 'kluchiki.vault.recovery.v1',
});

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function checkExactKeys(object, allowed, where) {
  if (!isPlainObject(object)) throw new TypeError(`${where}: ожидался объект`);
  const keys = Object.keys(object);
  for (const key of keys) {
    if (!allowed.includes(key)) throw new Error(`${where}: неизвестное поле ${key}`);
  }
  for (const key of allowed) {
    if (!(key in object)) throw new Error(`${where}: нет поля ${key}`);
  }
}

function assertKind(kind) {
  if (!SLOT_KINDS.includes(kind)) {
    throw new Error(`слот: неизвестный вид ${JSON.stringify(kind)}`);
  }
}

function assertMasterKey(masterKey) {
  assertBytes(masterKey, 'слот: MK');
  if (masterKey.length !== MK_BYTES) {
    throw new RangeError(`слот: MK должен быть ${MK_BYTES} байт`);
  }
}

function idBytes(id, name = 'слот: id') {
  if (id === undefined) return randomBytes(SLOT_ID_BYTES);
  if (typeof id === 'string') {
    const bytes = fromBase64url(id, name);
    if (bytes.length !== SLOT_ID_BYTES) {
      throw new Error(`${name}: нужно ${SLOT_ID_BYTES} байт`);
    }
    return bytes;
  }
  assertBytes(id, name);
  if (id.length !== SLOT_ID_BYTES) {
    throw new Error(`${name}: нужно ${SLOT_ID_BYTES} байт`);
  }
  return Uint8Array.from(id);
}

function saltBytes(kind, salt) {
  const expected = kind === 'password' ? PASSWORD_SALT_BYTES : HKDF_SALT_BYTES;
  if (salt === undefined) return randomBytes(expected);
  assertBytes(salt, 'слот: salt');
  if (salt.length !== expected) {
    throw new Error(`слот: salt для ${kind} должен быть ${expected} байт`);
  }
  return Uint8Array.from(salt);
}

function assertIterations(iterations, allowWeakKdf) {
  if (!Number.isSafeInteger(iterations)) {
    throw new RangeError('слот: iterations должно быть целым');
  }
  const minimum = allowWeakKdf ? 1 : MIN_ITERATIONS;
  if (iterations < minimum || iterations > MAX_ITERATIONS) {
    throw new RangeError(
      `слот: iterations должно быть от ${minimum} до ${MAX_ITERATIONS}`,
    );
  }
}

export function prfDescriptor(prf) {
  if (!isPlainObject(prf)) throw new TypeError('слот prf: нужен объект prf');
  checkExactKeys(prf, ['credentialId', 'rpId'], 'слот prf');
  if (typeof prf.credentialId !== 'string' || prf.credentialId.length === 0) {
    throw new Error('слот prf: credentialId должен быть непустой строкой');
  }
  // credentialId — base64url; проверяем алфавит и хвостовые биты.
  fromBase64url(prf.credentialId, 'слот prf: credentialId');
  if (typeof prf.rpId !== 'string' || prf.rpId.length === 0) {
    throw new Error('слот prf: rpId должен быть непустой строкой');
  }
  return { credentialId: prf.credentialId, rpId: prf.rpId };
}

// AAD слота: КJSON объекта слота без поля wrap.
export function slotAadBytes(slot) {
  if (!isPlainObject(slot)) throw new TypeError('AAD слота: ожидался объект');
  const aad = {};
  for (const key of Object.keys(slot)) {
    if (key !== 'wrap') aad[key] = slot[key];
  }
  return canonicalBytes(aad);
}

export function prfSalt(slotId) {
  let id = slotId;
  if (id instanceof Uint8Array) id = toBase64url(id);
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('prfSalt: нужен id слота');
  }
  return sha256(utf8(`kluchiki/prf/${id}`));
}

// Секрет слота в байтах. Для password — NFKC + UTF-8; для recovery
// строка — это код Crockford, а не произвольный текст.
export function slotSecretBytes(kind, secret) {
  assertKind(kind);
  if (kind === 'password') {
    if (typeof secret === 'string') return secretToBytes(secret);
    assertBytes(secret, 'слот password: секрет');
    return Uint8Array.from(secret);
  }
  if (kind === 'recovery' && typeof secret === 'string') {
    return parseRecoveryCode(secret);
  }
  assertBytes(secret, `слот ${kind}: секрет`);
  const bytes = Uint8Array.from(secret);
  if (kind === 'recovery' && bytes.length !== RECOVERY_BYTES) {
    throw new Error(`слот recovery: IKM должен быть ${RECOVERY_BYTES} байт`);
  }
  return bytes;
}

export async function deriveKek(slot, secret, { allowWeakKdf = false } = {}) {
  if (!isPlainObject(slot)) throw new TypeError('KEK: ожидался слот');
  assertKind(slot.kind);
  const secretBytes = slotSecretBytes(slot.kind, secret);

  if (slot.kind === 'password') {
    checkExactKeys(slot.kdf, ['name', 'iterations', 'salt'], 'слот: kdf');
    if (slot.kdf.name !== KDF_NAME.password) {
      throw new Error(`слот: для password нужен ${KDF_NAME.password}`);
    }
    const salt = fromBase64url(slot.kdf.salt, 'слот: salt');
    if (salt.length !== PASSWORD_SALT_BYTES) {
      throw new Error(`слот: salt для password должен быть ${PASSWORD_SALT_BYTES} байт`);
    }
    assertIterations(slot.kdf.iterations, allowWeakKdf);
    return pbkdf2Sha256(secretBytes, salt, slot.kdf.iterations, 32);
  }

  checkExactKeys(slot.kdf, ['name', 'salt', 'info'], 'слот: kdf');
  if (slot.kdf.name !== KDF_NAME[slot.kind]) {
    throw new Error(`слот: для ${slot.kind} нужен ${KDF_NAME[slot.kind]}`);
  }
  if (slot.kdf.info !== HKDF_INFO[slot.kind]) {
    throw new Error(`слот: info для ${slot.kind} не совпадает`);
  }
  const salt = fromBase64url(slot.kdf.salt, 'слот: salt');
  if (salt.length !== HKDF_SALT_BYTES) {
    throw new Error(`слот: salt для ${slot.kind} должен быть ${HKDF_SALT_BYTES} байт`);
  }
  return hkdfSha256(secretBytes, salt, slot.kdf.info, 32);
}

export async function createSlot({
  kind,
  secret,
  masterKey,
  id,
  salt,
  iv,
  iterations,
  prf,
  allowWeakKdf = false,
}) {
  assertKind(kind);
  assertMasterKey(masterKey);
  if (kind !== 'prf' && prf !== undefined) {
    throw new Error('слот: prf задаётся только для kind = "prf"');
  }

  const idValue = toBase64url(idBytes(id));
  const saltValue = saltBytes(kind, salt);
  let kdf;

  if (kind === 'password') {
    const count = iterations === undefined ? DEFAULT_ITERATIONS : iterations;
    assertIterations(count, allowWeakKdf);
    kdf = {
      name: KDF_NAME.password,
      iterations: count,
      salt: toBase64url(saltValue),
    };
  } else {
    if (iterations !== undefined) {
      throw new Error('слот: iterations задаётся только для password');
    }
    kdf = {
      name: KDF_NAME[kind],
      salt: toBase64url(saltValue),
      info: HKDF_INFO[kind],
    };
  }

  const slot = {
    version: SLOT_VERSION,
    id: idValue,
    kind,
    kdf,
  };
  if (kind === 'prf') slot.prf = prfDescriptor(prf);

  const kek = await deriveKek(slot, secret, { allowWeakKdf });
  const wrap = await aesGcmEncrypt(kek, masterKey, slotAadBytes(slot), iv);
  if (wrap.iv.length !== IV_BYTES) throw new Error('слот: IV обёртки не 12 байт');
  slot.wrap = {
    iv: toBase64url(wrap.iv),
    ct: toBase64url(wrap.ct),
    tag: toBase64url(wrap.tag),
  };
  return slot;
}

export async function unwrapMasterKey(slot, secret, options = {}) {
  checkExactKeys(slot.wrap, ['iv', 'ct', 'tag'], 'слот: wrap');
  const iv = fromBase64url(slot.wrap.iv, 'слот: wrap.iv');
  const ct = fromBase64url(slot.wrap.ct, 'слот: wrap.ct');
  const tag = fromBase64url(slot.wrap.tag, 'слот: wrap.tag');
  if (iv.length !== IV_BYTES) throw new Error('слот: wrap.iv должен быть 12 байт');
  if (ct.length !== MK_BYTES) throw new Error('слот: wrap.ct должен быть 32 байта');
  if (tag.length !== 16) throw new Error('слот: wrap.tag должен быть 16 байт');

  const kek = await deriveKek(slot, secret, options);
  const mk = await aesGcmDecrypt(kek, iv, ct, tag, slotAadBytes(slot));
  if (mk.length !== MK_BYTES) throw new Error('слот: MK не 32 байта');
  return mk;
}

// Добавляет слот, не меняя тело. Возвращает новый объект хранилища.
export async function addSlot(vault, spec, masterKey, options = {}) {
  if (!isPlainObject(vault) || !Array.isArray(vault.slots)) {
    throw new TypeError('addSlot: ожидалось хранилище со слотами');
  }
  if (vault.slots.length >= MAX_SLOTS) {
    throw new Error(`addSlot: больше ${MAX_SLOTS} слотов нельзя`);
  }
  let id = spec.id;
  if (id === undefined) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = randomBytes(SLOT_ID_BYTES);
      const value = toBase64url(candidate);
      if (!vault.slots.some((s) => s.id === value)) {
        id = candidate;
        break;
      }
    }
    if (id === undefined) throw new Error('addSlot: не удалось подобрать уникальный id');
  } else {
    const value = typeof id === 'string' ? id : toBase64url(id);
    if (vault.slots.some((s) => s.id === value)) {
      throw new Error('addSlot: слот с таким id уже есть');
    }
  }
  const slot = await createSlot({ ...spec, ...options, id, masterKey });
  return { ...vault, slots: [...vault.slots, slot] };
}

// Удаляет слот; последний удалить нельзя. Возвращает новый объект.
export function removeSlot(vault, id) {
  if (!isPlainObject(vault) || !Array.isArray(vault.slots)) {
    throw new TypeError('removeSlot: ожидалось хранилище со слотами');
  }
  if (vault.slots.length <= 1) {
    throw new Error('removeSlot: последний слот удалить нельзя');
  }
  const value = typeof id === 'string' ? id : toBase64url(id);
  const index = vault.slots.findIndex((slot) => slot.id === value);
  if (index < 0) throw new Error('removeSlot: слот не найден');
  return { ...vault, slots: vault.slots.filter((_, i) => i !== index) };
}

export function generateRecoveryCode() {
  return formatRecoveryCode(randomBytes(RECOVERY_BYTES));
}

export function formatRecoveryCode(bytes) {
  assertBytes(bytes, 'formatRecoveryCode');
  if (bytes.length !== RECOVERY_BYTES) {
    throw new Error(`код восстановления: нужно ${RECOVERY_BYTES} байт`);
  }
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(buffer >>> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out += CROCKFORD[(buffer << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join('-');
}

export function parseRecoveryCode(text) {
  if (typeof text !== 'string') throw new TypeError('код восстановления: ожидалась строка');
  const normalized = text.toUpperCase().replaceAll('-', '');
  if (normalized.length !== 32) {
    throw new Error('код восстановления: нужно 32 символа');
  }
  const out = new Uint8Array(RECOVERY_BYTES);
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const ch of normalized) {
    const value = CROCKFORD.indexOf(ch);
    if (value < 0) throw new Error('код восстановления: символ вне алфавита Crockford');
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >>> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  if (index !== RECOVERY_BYTES || bits !== 0 || buffer !== 0) {
    throw new Error('код восстановления: неверная длина');
  }
  return out;
}
