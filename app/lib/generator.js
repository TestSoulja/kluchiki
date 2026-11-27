// Генератор паролей: наборы, исключение похожих, энтропия (docs/ui.md §5.4).
// Случайность — только crypto.getRandomValues через randomBytes ядра;
// псевдослучайного источника из JavaScript здесь нет.

import { randomBytes } from '../../src/bytes.js';

export const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/<>~|'\"`\\";
export const SIMILAR = 'il1IO0o';
export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;
export const DEFAULT_LENGTH = 20;
export const WARN_LENGTH = 12;

export const CHARACTER_SETS = Object.freeze([
  {
    key: 'lower',
    chars: 'abcdefghijklmnopqrstuvwxyz',
    label: 'строчные a–z',
  },
  {
    key: 'upper',
    chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    label: 'прописные A–Z',
  },
  {
    key: 'digits',
    chars: '0123456789',
    label: 'цифры 0–9',
  },
  {
    key: 'symbols',
    chars: SYMBOLS,
    label: 'символы',
  },
]);

export function defaultOptions() {
  return {
    length: DEFAULT_LENGTH,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    excludeSimilar: false,
  };
}

export function clampLength(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_LENGTH;
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.trunc(number)));
}

function selectedSets(options) {
  return CHARACTER_SETS.filter((set) => options[set.key] === true);
}

export function buildAlphabet(options) {
  const seen = new Set();
  let out = '';
  for (const set of selectedSets(options)) {
    for (const ch of set.chars) {
      if (options.excludeSimilar === true && SIMILAR.includes(ch)) continue;
      if (seen.has(ch)) continue;
      seen.add(ch);
      out += ch;
    }
  }
  return out;
}

export function entropyBits(length, alphabetSize) {
  if (alphabetSize <= 0) return 0;
  return Math.floor(length * Math.log2(alphabetSize));
}

// Отбор без смещения: байты выше порога отбрасываются, а не берутся
// по модулю. Иначе короткие хвосты алфавита выпадали бы чаще.
export function generatePassword(options, getBytes = randomBytes) {
  const alphabet = buildAlphabet(options);
  if (alphabet.length === 0) {
    throw new Error('нужен хотя бы один набор');
  }
  const length = clampLength(options.length);
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    const bytes = getBytes(Math.max(16, length - out.length));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function describeResult(length, alphabetSize) {
  return `${clampLength(length)} символов · ${entropyBits(
    clampLength(length),
    alphabetSize,
  )} бит`;
}

// Предупреждение — только про длину, рядом с посчитанной энтропией.
export function isShort(length) {
  return clampLength(length) < WARN_LENGTH;
}
