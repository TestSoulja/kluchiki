// AES-256-GCM: шифрование и расшифровка с AAD.
//
// Тег 16 байт, IV 12 байт. IV передаётся снаружи только для векторов
// и тестов; в обычном пути он всегда из crypto.getRandomValues.
// При несовпадении тега WebCrypto не отдаёт открытый текст — вызывающий
// код не получает ни байта тела.

import { assertBytes, concatBytes, randomBytes } from './bytes.js';

export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;

function assertKey(key) {
  assertBytes(key, 'AES-GCM: ключ');
  if (key.length !== KEY_BYTES) {
    throw new RangeError(`AES-GCM: ключ должен быть ${KEY_BYTES} байт`);
  }
}

function assertIv(iv) {
  assertBytes(iv, 'AES-GCM: IV');
  if (iv.length !== IV_BYTES) {
    throw new RangeError(`AES-GCM: IV должен быть ${IV_BYTES} байт`);
  }
}

async function importAesKey(key) {
  return globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

// Возвращает { iv, ct, tag } — три Uint8Array.
// aad обязателен по смыслу, но допускается пустой массив.
export async function aesGcmEncrypt(key, plaintext, aad, iv = randomBytes(IV_BYTES)) {
  assertKey(key);
  assertBytes(plaintext, 'AES-GCM: открытый текст');
  assertBytes(aad, 'AES-GCM: AAD');
  assertIv(iv);

  const cryptoKey = await importAesKey(key);
  const sealed = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
        tagLength: TAG_BYTES * 8,
      },
      cryptoKey,
      plaintext,
    ),
  );

  if (sealed.length < TAG_BYTES) {
    throw new Error('AES-GCM: WebCrypto вернул короче тега');
  }
  const ctLength = sealed.length - TAG_BYTES;
  return {
    iv: Uint8Array.from(iv),
    ct: sealed.slice(0, ctLength),
    tag: sealed.slice(ctLength),
  };
}

// Возвращает открытый текст. Бросает при любом несовпадении тега,
// включая изменённый AAD, IV или шифртекст.
export async function aesGcmDecrypt(key, iv, ct, tag, aad) {
  assertKey(key);
  assertIv(iv);
  assertBytes(ct, 'AES-GCM: шифртекст');
  assertBytes(tag, 'AES-GCM: тег');
  assertBytes(aad, 'AES-GCM: AAD');
  if (tag.length !== TAG_BYTES) {
    throw new RangeError(`AES-GCM: тег должен быть ${TAG_BYTES} байт`);
  }

  const cryptoKey = await importAesKey(key);
  const opened = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
      tagLength: TAG_BYTES * 8,
    },
    cryptoKey,
    concatBytes(ct, tag),
  );
  return new Uint8Array(opened);
}
