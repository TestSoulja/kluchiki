// Вывод ключа через WebCrypto: PBKDF2-HMAC-SHA256, HKDF-SHA256, SHA-256.
//
// Никаких зависимостей и никакого node:crypto: тот же код работает
// в браузере. Секреты не кэшируются: ключ живёт только в вызове.

import { assertBytes, utf8 } from './bytes.js';

function assertIterations(iterations) {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError('PBKDF2: итерации должны быть целым >= 1');
  }
}

function assertLength(lengthBytes) {
  if (!Number.isInteger(lengthBytes) || lengthBytes < 1) {
    throw new RangeError('KDF: длина ключа должна быть целым >= 1 байт');
  }
}

// §2.3: пароль и код восстановления нормализуются в NFKC, затем UTF-8.
// Не обрезаем, не меняем регистр.
export function normalizeSecret(text) {
  if (typeof text !== 'string') throw new TypeError('normalizeSecret: ожидалась строка');
  return text.normalize('NFKC');
}

export function secretToBytes(text) {
  return utf8(normalizeSecret(text));
}

export async function pbkdf2Sha256(password, salt, iterations, lengthBytes = 32) {
  assertBytes(password, 'PBKDF2: password');
  assertBytes(salt, 'PBKDF2: salt');
  assertIterations(iterations);
  assertLength(lengthBytes);

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    password,
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

function infoBytes(info, name) {
  if (typeof info === 'string') return utf8(info);
  assertBytes(info, name);
  return info;
}

export async function hkdfSha256(ikm, salt, info, lengthBytes = 32) {
  assertBytes(ikm, 'HKDF: IKM');
  assertBytes(salt, 'HKDF: salt');
  assertLength(lengthBytes);

  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    ikm,
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: infoBytes(info, 'HKDF: info'),
    },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function sha256(bytes) {
  assertBytes(bytes, 'sha256');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}
