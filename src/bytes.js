// Байтовые помощники ядра.
//
// Только стандартные объекты и WebCrypto: ни Buffer, ни node:crypto,
// ни сторонних библиотек. Это позволяет тому же коду работать в браузере.

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function assertBytes(value, name = 'bytes') {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${name}: ожидался Uint8Array`);
  }
}

export function utf8(text) {
  if (typeof text !== 'string') throw new TypeError('utf8: ожидалась строка');
  return encoder.encode(text);
}

export function utf8Decode(bytes) {
  assertBytes(bytes, 'utf8Decode');
  // fatal: битая последовательность UTF-8 — ошибка, а не замена на U+FFFD.
  return decoder.decode(bytes);
}

export function randomBytes(length) {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('randomBytes: длина должна быть целым >= 0');
  }
  if (length > 65536) {
    // Предел crypto.getRandomValues за один вызов.
    throw new RangeError('randomBytes: не больше 65536 байт за вызов');
  }
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) {
    assertBytes(a, 'concatBytes');
    total += a.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export function bytesEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function toBase64url(bytes) {
  assertBytes(bytes, 'toBase64url');
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64URL[(n >>> 18) & 63];
    out += BASE64URL[(n >>> 12) & 63];
    out += BASE64URL[(n >>> 6) & 63];
    out += BASE64URL[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += BASE64URL[(n >>> 18) & 63];
    out += BASE64URL[(n >>> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64URL[(n >>> 18) & 63];
    out += BASE64URL[(n >>> 12) & 63];
    out += BASE64URL[(n >>> 6) & 63];
  }
  return out;
}

// Строго: только алфавит §2.1, без '=', без пробелов, хвостовые биты нулевые.
export function fromBase64url(text, name = 'base64url') {
  if (typeof text !== 'string') throw new TypeError(`${name}: ожидалась строка`);
  if (text.length % 4 === 1) throw new Error(`${name}: неверная длина base64url`);
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let value = 0;
  let bits = 0;
  let index = 0;
  for (const ch of text) {
    const v = BASE64URL.indexOf(ch);
    if (v < 0) throw new Error(`${name}: символ вне алфавита base64url`);
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >>> bits) & 0xff;
      value &= (1 << bits) - 1;
    }
  }
  if (index !== out.length) throw new Error(`${name}: неверная длина base64url`);
  if (bits > 0 && value !== 0) {
    throw new Error(`${name}: ненулевые хвостовые биты`);
  }
  return out;
}

export function toHex(bytes) {
  assertBytes(bytes, 'toHex');
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex, name = 'hex') {
  if (typeof hex !== 'string') throw new TypeError(`${name}: ожидалась строка`);
  if (hex.length % 2 !== 0) throw new Error(`${name}: нечётная длина`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const pair = hex.slice(i * 2, i * 2 + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) throw new Error(`${name}: не hex`);
    out[i] = Number.parseInt(pair, 16);
  }
  return out;
}
