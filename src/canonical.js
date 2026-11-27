// Канонический JSON (КJSON) по docs/format.md §2.2.
//
// Назначение: получить одни и те же байты из одного и того же значения
// независимо от порядка ключей и форматирования. Используется для AAD
// и для открытого текста тела; в файле форматирование JSON не значимо.
//
// Чего §2.2 не описывал и что решено здесь (записано в format.md):
// - числа: только безопасные целые (|n| <= 2^53 - 1); -0 печатается как 0;
// - строки: одиночные суррогаты отвергаются (UTF-8 не может их сохранить),
//   управляющие символы < 0x20 экранируются как \u00xx (строчные буквы);
// - значения: только null, boolean, строка, безопасное целое, массив,
//   обычный объект; undefined, функции, символы, BigInt и классы — отказ;
// - циклические ссылки — отказ;
// - повторяющиеся ключи в JSON-тексте — забота JSON.parse, см. format.md.

const encoder = new TextEncoder();

function fail(message) {
  throw new TypeError(`КJSON: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// RFC 8259 §7: минимальное экранирование строки. Суррогатная пара
// сохраняется как есть; одиночный суррогат отвергается.
function encodeString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x22) {
      out += '\\"';
    } else if (code === 0x5c) {
      out += '\\\\';
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail('одиночный суррогат в строке');
      }
      out += value[i] + value[i + 1];
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('одиночный суррогат в строке');
    } else {
      out += value[i];
    }
  }
  return `${out}"`;
}

function encodeValue(value, seen) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';

  const type = typeof value;
  if (type === 'string') return encodeString(value);
  if (type === 'number') {
    if (!Number.isSafeInteger(value)) {
      fail('число должно быть безопасным целым');
    }
    // String(-0) === "0"; отдельная ветка не нужна.
    return String(value);
  }
  if (type === 'bigint') fail('BigInt не поддерживается');
  if (type === 'undefined') fail('undefined не поддерживается');
  if (type === 'function') fail('функции не поддерживаются');
  if (type === 'symbol') fail('символы не поддерживаются');

  if (Array.isArray(value)) {
    if (seen.has(value)) fail('циклическая ссылка');
    seen.add(value);
    const parts = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) fail('разреженный массив не поддерживается');
      parts.push(encodeValue(value[i], seen));
    }
    seen.delete(value);
    return `[${parts.join(',')}]`;
  }

  if (!isPlainObject(value)) {
    fail('объект должен быть обычным (Object или null-прототип)');
  }
  if (seen.has(value)) fail('циклическая ссылка');
  seen.add(value);

  // Сортировка по кодам UTF-16: операторы < и > на строках сравнивают
  // именно кодовые единицы, без локали.
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts = [];
  for (const key of keys) {
    if (typeof value[key] === 'undefined') {
      fail(`ключ ${JSON.stringify(key)}: undefined не поддерживается`);
    }
    parts.push(`${encodeString(key)}:${encodeValue(value[key], seen)}`);
  }
  seen.delete(value);
  return `{${parts.join(',')}}`;
}

export function canonicalize(value) {
  return encodeValue(value, new Set());
}

export function canonicalBytes(value) {
  return encoder.encode(canonicalize(value));
}
