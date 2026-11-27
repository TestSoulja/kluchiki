// Умный поиск по записям: заголовок, логин, адрес и метки
// (plan.md §7, docs/ui.md §5.2). Пароль в поиск не входит никогда.
//
// Сравнение идёт по нормализованной строке: NFKC, нижний регистр, ё → е.
// Для каждого поля считаются слова, «склейка» без разделителей и
// транслит; для запроса — ещё и вариант в другой раскладке. Правила
// совпадения — от точного начала слова к подстроке и одной опечатке.

export function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е');
}

// Всё, что не буква и не цифра, разделяет слова. Регулярное выражение
// постоянное: пользовательский ввод в него не попадает.
const WORD_SEPARATORS = /[^\p{L}\p{N}]+/u;

function words(value) {
  return value.split(WORD_SEPARATORS).filter(Boolean);
}

function glue(value) {
  return value.replace(/[^\p{L}\p{N}]+/gu, '');
}

const TRANSLIT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function translit(value) {
  let out = '';
  for (const char of value) {
    out += TRANSLIT[char] ?? char;
  }
  return out;
}

// ЙЦУКЕН ↔ QWERTY: пары идут в порядке клавиш, поэтому таблица
// обратима. Вариант годится, только если отобразился каждый символ.
const CYRILLIC_KEYS = 'йцукенгшщзхъфывапролджэячсмитьбю';
const LATIN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const LAYOUT = new Map();
for (let index = 0; index < CYRILLIC_KEYS.length; index++) {
  LAYOUT.set(CYRILLIC_KEYS[index], LATIN_KEYS[index]);
  LAYOUT.set(LATIN_KEYS[index], CYRILLIC_KEYS[index]);
}

function layoutWord(word) {
  let out = '';
  for (const char of word) {
    const mapped = LAYOUT.get(char);
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out === word ? null : out;
}

const FIELD_VALUES = [
  (entry) => entry.title,
  (entry) => entry.login,
  (entry) => entry.url,
  (entry) =>
    Array.isArray(entry.tags) ? entry.tags.join(' ') : String(entry.tags ?? ''),
];

function prepareField(value) {
  const text = normalize(value);
  const wordList = words(text);
  const translitText = translit(text);
  return {
    text,
    words: wordList,
    glue: glue(text),
    translitText,
    translitWords: words(translitText),
    translitGlue: glue(translitText),
  };
}

function prepareQuery(value) {
  const text = normalize(value).trim();
  const wordList = words(text);
  const translitText = translit(text);
  // Транслит и раскладка — только на запросе от двух символов.
  const variants = text.length >= 2;
  const mapped = variants ? wordList.map(layoutWord) : [];
  const layoutWords =
    variants && mapped.every((word) => word !== null) ? mapped : null;
  return {
    text,
    words: wordList,
    glue: glue(text),
    translitText,
    translitWords: words(translitText),
    translitGlue: glue(translitText),
    variants,
    layoutWords,
  };
}

// Каждое слово запроса начинает слово в одном и том же поле.
function everyWordStarts(fieldWords, queryWords) {
  return queryWords.every((needle) =>
    fieldWords.some((word) => word.startsWith(needle)),
  );
}

function contains(field, query) {
  return (
    (query.text !== '' && field.text.includes(query.text)) ||
    (query.glue !== '' && field.glue.includes(query.glue))
  );
}

function containsTranslit(field, query) {
  return (
    (query.translitText !== '' &&
      field.translitText.includes(query.translitText)) ||
    (query.translitGlue !== '' &&
      field.translitGlue.includes(query.translitGlue))
  );
}

// Расстояние ровно в одну замену, вставку или удаление.
function withinOneEdit(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let index = 0;
  while (
    index < left.length &&
    index < right.length &&
    left[index] === right[index]
  ) {
    index++;
  }
  if (left.length === right.length) {
    return left.slice(index + 1) === right.slice(index + 1);
  }
  if (left.length === right.length + 1) {
    return left.slice(index + 1) === right.slice(index);
  }
  return left.slice(index) === right.slice(index + 1);
}

function hasOneTypo(field, query) {
  for (const queryWord of query.words) {
    if (queryWord.length < 4) continue;
    const queryForms = [queryWord, translit(queryWord)];
    for (const fieldWord of field.words) {
      const fieldForms = [fieldWord, translit(fieldWord)];
      for (const left of queryForms) {
        for (const right of fieldForms) {
          if (withinOneEdit(left, right.slice(0, left.length))) return true;
        }
      }
    }
  }
  return false;
}

// null — поле не совпало; иначе tier 0…5.
function matchTier(field, query) {
  if (everyWordStarts(field.words, query.words)) return 0;
  if (
    query.variants &&
    query.translitWords.length === query.words.length &&
    everyWordStarts(field.translitWords, query.translitWords)
  ) {
    return 1;
  }
  if (
    query.variants &&
    query.layoutWords !== null &&
    everyWordStarts(field.words, query.layoutWords)
  ) {
    return 2;
  }
  if (contains(field, query)) return 3;
  if (query.variants && containsTranslit(field, query)) return 4;
  if (hasOneTypo(field, query)) return 5;
  return null;
}

function scoreEntry(entry, query) {
  let best = null;
  for (let field = 0; field < FIELD_VALUES.length; field++) {
    const tier = matchTier(prepareField(FIELD_VALUES[field](entry)), query);
    if (tier === null) continue;
    const score = tier * 10 + field;
    if (best === null || score < best) best = score;
    if (best === 0) break;
  }
  return best;
}

export function matchesEntry(entry, query) {
  const prepared = prepareQuery(query);
  if (prepared.words.length === 0) return true;
  return scoreEntry(entry, prepared) !== null;
}

export function filterEntries(entries, query) {
  const prepared = prepareQuery(query);
  if (prepared.words.length === 0) return entries.slice();

  const ranked = [];
  entries.forEach((entry, order) => {
    const score = scoreEntry(entry, prepared);
    if (score !== null) ranked.push({ entry, score, order });
  });
  // Сортировка стабильная: при равном счёте — прежний порядок записей.
  ranked.sort((left, right) => left.score - right.score || left.order - right.order);
  return ranked.map((item) => item.entry);
}

export function plural(count, one, few, many) {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

export function entriesCountLabel(count) {
  return `${count} ${plural(count, 'запись', 'записи', 'записей')}`;
}

// «12 записей · найдено 3»; без запроса — только счётчик.
export function countLabel(total, found, query) {
  const label = entriesCountLabel(total);
  return normalize(query).trim() === '' ? label : `${label} · найдено ${found}`;
}
