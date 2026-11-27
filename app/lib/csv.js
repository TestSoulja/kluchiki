// CSV для переноса записей (plan.md §6, ui.md §5.7.1).
//
// Разбор по RFC 4180: поля в кавычках, «""» внутри поля, запятая и перевод
// строки внутри поля. Разделитель — «,», «;» или таб; строка «sep=,» от
// Excel считается служебной. Здесь нет DOM: модуль проверяется в node --test.
//
// Экспорт — открытый текст. Поэтому он живёт отдельной кнопкой с
// подтверждением, а не вместо зашифрованного .vault.

export const CSV_LIMITS = Object.freeze({
  bytes: 1024 * 1024,
  rows: 2000,
  fieldChars: 512,
});

export const CSV_FIELDS = Object.freeze([
  { key: 'title', label: 'Название', pattern: /^(name|title)$/i },
  { key: 'login', label: 'Логин', pattern: /login|user/i },
  { key: 'password', label: 'Пароль', pattern: /pass/i },
  { key: 'url', label: 'Адрес', pattern: /url|site|web/i },
  { key: 'notes', label: 'Заметки', pattern: /note|comment/i },
  { key: 'tags', label: 'Теги', pattern: /^tags?$/i },
]);

// Заголовок распознаётся по пяти обязательным колонкам; теги ищутся, но
// в порог не входят — иначе почти любая строка данных станет заголовком.
const HEADER_PATTERNS = CSV_FIELDS.slice(0, 5).map((field) => field.pattern);

export const CSV_EXPORT_HEADER = Object.freeze([
  'Name',
  'URL',
  'Login name',
  'Password',
  'Notes',
  'Tags',
]);

export class CsvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CsvError';
  }
}

function countOutsideQuotes(line, symbol) {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && line[i] === symbol) count += 1;
  }
  return count;
}

function detectDelimiter(text) {
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.trim() !== '') {
      let best = ',';
      let bestCount = 0;
      for (const candidate of [',', ';', '\t']) {
        const count = countOutsideQuotes(line, candidate);
        if (count > bestCount) {
          best = candidate;
          bestCount = count;
        }
      }
      return best;
    }
    if (end >= text.length) break;
    start = end + 1;
  }
  return ',';
}

// Строка Excel «sep=;» задаёт разделитель и не является данными. Строку
// заменяем пустой, чтобы номера строк в ошибках остались прежними.
function findServiceLine(text) {
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.trim() !== '') {
      const match = /^\s*sep=(.)\s*$/i.exec(line);
      if (!match) return null;
      return {
        delimiter: match[1],
        start,
        end: end < text.length ? end + 1 : end,
      };
    }
    if (end >= text.length) break;
    start = end + 1;
  }
  return null;
}

function readRecords(text, delimiter) {
  const records = [];
  let cells = [];
  let field = '';
  let inQuotes = false;
  let quoteLine = 1;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  const finishRecord = () => {
    cells.push(field);
    records.push({ cells, line: recordLine });
    cells = [];
    field = '';
    line += 1;
    recordLine = line;
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (char === '\n') line += 1;
      else if (char === '\r' && text[i + 1] !== '\n') line += 1;
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      quoteLine = line;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      cells.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      if (text[i + 1] === '\n') i += 1;
      finishRecord();
      i += 1;
      continue;
    }
    if (char === '\n') {
      finishRecord();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) {
    throw new CsvError(
      `не удалось разобрать CSV: строка ${quoteLine}, незакрытая кавычка`,
    );
  }
  if (field !== '' || cells.length > 0) {
    cells.push(field);
    records.push({ cells, line: recordLine });
  }
  return records;
}

function isBlankRecord(record) {
  return record.cells.length === 1 && record.cells[0] === '';
}

function looksLikeHeader(cells) {
  let hits = 0;
  for (const cell of cells) {
    const value = cell.trim();
    if (HEADER_PATTERNS.some((pattern) => pattern.test(value))) hits += 1;
  }
  return hits >= 2;
}

function codePointLength(value) {
  return Array.from(value).length;
}

function checkFieldLimits(records) {
  for (const record of records) {
    for (const cell of record.cells) {
      const length = codePointLength(cell);
      if (length > CSV_LIMITS.fieldChars) {
        throw new CsvError(
          `не удалось разобрать CSV: строка ${record.line}, поле длиннее ` +
            `${CSV_LIMITS.fieldChars} символов (${length})`,
        );
      }
    }
  }
}

export function parseCsv(text, { bytes } = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('CSV: ожидалась строка');
  }
  const size =
    bytes === undefined ? new TextEncoder().encode(text).length : Number(bytes);
  if (size > CSV_LIMITS.bytes) {
    throw new CsvError(
      `не удалось разобрать CSV: файл больше 1 МБ (${size} байт)`,
    );
  }

  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const service = findServiceLine(clean);
  const source = service
    ? `${clean.slice(0, service.start)}\n${clean.slice(service.end)}`
    : clean;
  const delimiter = service ? service.delimiter : detectDelimiter(source);
  let records = readRecords(source, delimiter).filter(
    (record) => !isBlankRecord(record),
  );

  checkFieldLimits(records);

  const hasHeader = records.length > 0 && looksLikeHeader(records[0].cells);
  const header = hasHeader ? [...records[0].cells] : null;
  const dataRecords = hasHeader ? records.slice(1) : records;
  if (dataRecords.length > CSV_LIMITS.rows) {
    throw new CsvError(
      `не удалось разобрать CSV: ${dataRecords.length} строк данных, ` +
        `потолок ${CSV_LIMITS.rows}`,
    );
  }

  const rows = dataRecords.map((record) => record.cells);
  let columns = header ? header.length : 0;
  for (const row of rows) columns = Math.max(columns, row.length);

  return {
    delimiter,
    hasHeader,
    header,
    rows,
    columns,
    rowCount: rows.length,
  };
}

export function suggestMapping(header, columns) {
  const mapping = Object.fromEntries(CSV_FIELDS.map((field) => [field.key, null]));
  const width = Math.max(0, Number(columns) || 0);
  if (!header) {
    // Без заголовка — позиции как в типичном CSV: название, логин, пароль,
    // адрес, заметки. Тегов нет.
    ['title', 'login', 'password', 'url', 'notes'].forEach((key, index) => {
      if (index < width) mapping[key] = index;
    });
    return mapping;
  }
  for (let index = 0; index < width; index++) {
    const label = String(header[index] ?? '').trim();
    if (label === '') continue;
    for (const field of CSV_FIELDS) {
      if (mapping[field.key] === null && field.pattern.test(label)) {
        mapping[field.key] = index;
        break;
      }
    }
  }
  return mapping;
}

function cellAt(cells, index) {
  if (index === null || index === undefined) return '';
  return String(cells[index] ?? '');
}

function parseTagCell(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

function hostFromUrl(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  try {
    return new URL(raw).hostname;
  } catch {
    // Без схемы URL не разбирается: берём часть до слэша, «?» или «#».
    return raw
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .split(/[/?#]/)[0]
      .split('@')
      .pop()
      .split(':')[0];
  }
}

export function rowValues(cells, mapping) {
  return {
    title: cellAt(cells, mapping.title).trim(),
    login: cellAt(cells, mapping.login),
    password: cellAt(cells, mapping.password),
    url: cellAt(cells, mapping.url),
    notes: cellAt(cells, mapping.notes),
    tags: parseTagCell(cellAt(cells, mapping.tags)),
  };
}

export function titleForRow(values, number) {
  if (values.title !== '') return values.title;
  const host = hostFromUrl(values.url);
  return host !== '' ? host : `Запись ${number}`;
}

function isEmptyRow(values) {
  return (
    values.title === '' &&
    values.login === '' &&
    values.password === '' &&
    values.url === '' &&
    values.notes === '' &&
    values.tags.length === 0
  );
}

export function dedupeKey(entry) {
  return JSON.stringify([
    String(entry.title ?? ''),
    String(entry.login ?? ''),
    String(entry.password ?? ''),
  ]);
}

// План импорта: не пишет ничего сам. added — новые записи (ровно девять
// ключей формата), matched — совпали с хранилищем или с более ранней
// строкой этого же файла, skipped — пустые строки.
export function planImport({
  rows,
  mapping,
  existing = [],
  nowIso = new Date().toISOString(),
  makeId,
} = {}) {
  if (!Array.isArray(rows)) throw new TypeError('CSV: rows должен быть массивом');
  if (!mapping || typeof mapping !== 'object') {
    throw new TypeError('CSV: нужно сопоставление колонок');
  }
  const idFactory =
    typeof makeId === 'function'
      ? makeId
      : () => globalThis.crypto.randomUUID();
  const seen = new Set(existing.map((entry) => dedupeKey(entry)));
  const added = [];
  let matched = 0;
  let skipped = 0;

  rows.forEach((cells, index) => {
    const values = rowValues(cells, mapping);
    if (isEmptyRow(values)) {
      skipped += 1;
      return;
    }
    const entry = {
      id: idFactory(),
      title: titleForRow(values, index + 1),
      login: values.login,
      password: values.password,
      url: values.url,
      notes: values.notes,
      tags: values.tags,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const key = dedupeKey(entry);
    if (seen.has(key)) {
      matched += 1;
      return;
    }
    seen.add(key);
    added.push(entry);
  });

  return { added, matched, skipped };
}

// Один вызов saveEntries в самом конце. Ошибка разбора или проверки до
// него не доходит, поэтому прежний файл на диске остаётся байт в байт.
export async function importCsv({
  text,
  bytes,
  mapping,
  entries = [],
  saveEntries,
  nowIso,
  parsed: preParsed,
} = {}) {
  const parsed = preParsed ?? parseCsv(text, { bytes });
  const plan = planImport({
    rows: parsed.rows,
    mapping,
    existing: entries,
    nowIso,
  });
  if (plan.added.length > 0) {
    if (typeof saveEntries !== 'function') {
      throw new TypeError('CSV: нужна функция saveEntries');
    }
    await saveEntries([...entries, ...plan.added]);
  }
  return {
    added: plan.added.length,
    matched: plan.matched,
    skipped: plan.skipped,
    parsed,
  };
}

function csvCell(value, alwaysQuote = false) {
  const text = value === null || value === undefined ? '' : String(value);
  if (alwaysQuote || /[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvExportText(entries, { header = CSV_EXPORT_HEADER } = {}) {
  const lines = [header.map((cell) => csvCell(cell)).join(',')];
  for (const entry of entries ?? []) {
    const cells = [
      entry.title,
      entry.url,
      entry.login,
      entry.password,
      entry.notes,
      Array.isArray(entry.tags) ? entry.tags.join(', ') : '',
    ];
    lines.push(
      cells
        .map((value, index) =>
          csvCell(value, index === cells.length - 1 && String(value) !== ''),
        )
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function csvExportFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `kluchiki-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}.csv`;
}
