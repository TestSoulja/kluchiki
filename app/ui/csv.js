// Экран «Импорт CSV» (docs/ui.md §5.7.1). Только при разблокированном
// хранилище: записи вписываются в зашифрованный файл одной записью в конце.

import {
  el,
  heading,
  button,
  iconButton,
  labelFor,
  checkbox,
  hint,
  downloadBlob,
  focusHeading,
} from './dom.js';
import { backIcon } from './icons.js';
import {
  CSV_FIELDS,
  CSV_LIMITS,
  csvExportFilename,
  csvExportText,
  importCsv,
  parseCsv,
  planImport,
  rowValues,
  suggestMapping,
  titleForRow,
} from '../lib/csv.js';

const MASK = '••••••••';

const FIELD_LABELS = Object.freeze({
  title: 'Название (если «нет» — из адреса)',
  login: 'Логин',
  password: 'Пароль',
  url: 'Адрес',
  notes: 'Заметки',
  tags: 'Теги',
});

function delimiterLabel(delimiter) {
  if (delimiter === ';') return 'точка с запятой';
  if (delimiter === '\t') return 'таб';
  return 'запятая';
}

function pluralRecords(count) {
  const tail = count % 100;
  const last = count % 10;
  if (last === 1 && tail !== 11) return 'запись';
  if ([2, 3, 4].includes(last) && ![12, 13, 14].includes(tail)) return 'записи';
  return 'записей';
}

function isEmpty(values) {
  return (
    values.title === '' &&
    values.login === '' &&
    values.password === '' &&
    values.url === '' &&
    values.notes === '' &&
    values.tags.length === 0
  );
}

function previewLine(key, value) {
  return el(
    'div',
    { class: 'csv-line' },
    el('span', { class: 'csv-key', text: key }),
    el('span', { class: 'csv-val', text: value === '' ? '—' : value }),
  );
}

export function renderCsv(app) {
  if (!app.session) {
    app.reset('unlock');
    return;
  }

  const page = el('div', { class: 'page page-narrow' });
  const back = iconButton('Назад', '', () => app.back());
  back.replaceChildren(backIcon());
  page.append(
    el(
      'div',
      { class: 'screen-header' },
      back,
      heading('Импорт CSV'),
      el('span', { class: 'header-spacer' }),
    ),
  );

  page.append(
    el('p', {
      class: 'text',
      text:
        'CSV — открытый текст; после импорта удалите файл, приложение его ' +
        'не удаляет. Записи добавляются к текущим; хранилище не заменяется.',
    }),
  );

  const state = {
    text: '',
    parsed: null,
    mapping: null,
    plan: null,
  };

  const fileId = 'csv-file';
  const fileInput = el('input', {
    id: fileId,
    type: 'file',
    class: 'sr-only file-input',
    accept: '.csv,text/csv,text/plain',
  });
  const pick = el('label', {
    class: 'btn btn-secondary',
    for: fileId,
    text: 'Выбрать CSV',
  });
  const pickBox = el('div', { class: 'file-pick' }, pick, fileInput);
  const chosen = el('p', { class: 'hint', text: 'файл не выбран' });
  const summary = el('p', { class: 'hint', hidden: true });
  const error = el('p', { class: 'error', role: 'status', hidden: true });

  const stepOne = el(
    'section',
    { class: 'section' },
    el('h2', { class: 'h2', text: '1. Файл' }),
    el('div', { class: 'field' }, pickBox, chosen),
    summary,
    error,
  );
  page.append(stepOne);

  const stepTwo = el(
    'section',
    { class: 'section', hidden: true },
    el('h2', { class: 'h2', text: '2. Колонки' }),
    el('p', {
      class: 'hint',
      text:
        'Каждой колонке Kluchiki — колонка из файла или «нет». Если названия ' +
        'нет, оно берётся из адреса, иначе «Запись N».',
    }),
  );
  const mappingBox = el('div', { class: 'csv-mapping' });
  stepTwo.append(mappingBox);
  page.append(stepTwo);

  const stepThree = el(
    'section',
    { class: 'section', hidden: true },
    el('h2', { class: 'h2', text: '3. Предпросмотр' }),
  );
  const preview = el('div', { class: 'csv-preview' });
  const counts = el('p', { class: 'counter' });
  const result = el('p', { class: 'hint', role: 'status', hidden: true });
  const submit = button('Добавить 0 записей', { type: 'submit' });
  submit.disabled = true;
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    preview,
    counts,
    el('div', { class: 'actions' }, submit),
    result,
  );
  stepThree.append(form);
  page.append(stepThree);

  function showError(message) {
    error.hidden = false;
    error.textContent = message;
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
  }

  function resetAfterFile() {
    state.text = '';
    state.parsed = null;
    state.mapping = null;
    state.plan = null;
    stepTwo.hidden = true;
    stepThree.hidden = true;
    summary.hidden = true;
    mappingBox.replaceChildren();
    preview.replaceChildren();
    result.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Добавить 0 записей';
  }

  function renderMapping() {
    mappingBox.replaceChildren();
    const parsed = state.parsed;
    if (!parsed) return;
    for (const field of CSV_FIELDS) {
      const id = `csv-map-${field.key}`;
      const select = el('select', { id, class: 'input' });
      select.append(el('option', { value: '' }, 'нет'));
      for (let index = 0; index < parsed.columns; index++) {
        const header = parsed.header ? String(parsed.header[index] ?? '').trim() : '';
        const label = header !== '' ? header : `Колонка ${index + 1}`;
        select.append(
          el(
            'option',
            {
              value: String(index),
              selected: state.mapping[field.key] === index,
            },
            label,
          ),
        );
      }
      select.addEventListener('change', () => {
        state.mapping[field.key] =
          select.value === '' ? null : Number(select.value);
        updatePreview();
      });
      mappingBox.append(
        el(
          'div',
          { class: 'field' },
          labelFor(id, FIELD_LABELS[field.key]),
          select,
        ),
      );
    }
  }

  function updatePreview() {
    const parsed = state.parsed;
    if (!parsed) return;
    state.plan = planImport({
      rows: parsed.rows,
      mapping: state.mapping,
      existing: app.session.entries,
    });

    preview.replaceChildren();
    parsed.rows
      .map((cells, index) => ({ cells, index }))
      .filter(({ cells }) => !isEmpty(rowValues(cells, state.mapping)))
      .slice(0, 3)
      .forEach(({ cells, index }) => {
        const values = rowValues(cells, state.mapping);
        const card = el(
          'div',
          { class: 'csv-record' },
          previewLine('Название', titleForRow(values, index + 1)),
          previewLine('Логин', values.login),
          previewLine('Пароль', values.password === '' ? '' : MASK),
          previewLine('Адрес', values.url),
          previewLine('Заметки', values.notes),
        );
        if (values.tags.length > 0) {
          card.append(previewLine('Теги', values.tags.join(', ')));
        }
        preview.append(card);
      });

    const { added, matched, skipped } = state.plan;
    counts.textContent = `новых: ${added.length}, совпадений: ${matched}, пустых: ${skipped}`;
    submit.textContent = `Добавить ${added.length} ${pluralRecords(added.length)}`;
    submit.disabled = added.length === 0;
  }

  fileInput.addEventListener('change', async () => {
    const file =
      fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    clearError();
    resetAfterFile();
    if (!file) {
      chosen.textContent = 'файл не выбран';
      return;
    }
    chosen.textContent = `выбран файл: ${file.name}`;
    if (file.size > CSV_LIMITS.bytes) {
      showError(`файл больше 1 МБ: ${file.size} байт`);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      showError('не удалось прочитать файл');
      return;
    }
    let parsed;
    try {
      parsed = parseCsv(text, { bytes: file.size });
    } catch (failure) {
      showError(
        failure && failure.message ? failure.message : 'не удалось разобрать CSV',
      );
      return;
    }
    if (parsed.rowCount === 0) {
      showError('в CSV нет строк данных');
      return;
    }
    state.text = text;
    state.parsed = parsed;
    state.mapping = suggestMapping(parsed.header, parsed.columns);
    summary.hidden = false;
    summary.textContent =
      `строк данных: ${parsed.rowCount}; ` +
      `разделитель: ${delimiterLabel(parsed.delimiter)}; ` +
      `заголовок: ${parsed.hasHeader ? 'есть' : 'нет'}`;
    stepTwo.hidden = false;
    stepThree.hidden = false;
    renderMapping();
    updatePreview();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.plan || state.plan.added.length === 0) return;
    submit.disabled = true;
    submit.textContent = 'Добавляем…';
    try {
      const imported = await importCsv({
        text: state.text,
        parsed: state.parsed,
        mapping: state.mapping,
        entries: app.session.entries,
        saveEntries: (next) => app.saveEntries(next),
      });
      app.reset('list');
      app.toast(
        `добавлено ${imported.added}, совпало ${imported.matched}, ` +
          `пропущено ${imported.skipped}`,
      );
    } catch (failure) {
      result.hidden = false;
      result.textContent = app.describeSaveError(failure);
      submit.disabled = false;
      submit.textContent = `Добавить ${state.plan.added.length} ${pluralRecords(
        state.plan.added.length,
      )}`;
    }
  });

  page.append(
    hint(
      'потолки: файл 1 МБ, 2000 строк, 512 символов на поле. ' +
        'Больше — отказ целиком, без частичного импорта',
    ),
  );

  app.cleanup = null;
  app.root.replaceChildren(page);
  focusHeading(page);
}

// Экспорт CSV — отдельная кнопка под зашифрованным экспортом, с
// подтверждением «понимаю, что файл не зашифрован» (plan.md §6).
export function csvExportSection(app) {
  const section = el(
    'section',
    { class: 'section' },
    el('h2', { class: 'h2', text: 'CSV (открытым текстом)' }),
    el('p', {
      class: 'text',
      text:
        'CSV не зашифрован: любой, у кого есть файл, прочитает записи. ' +
        'Колонки: Name, URL, Login name, Password, Notes, Tags. Порядок — ' +
        'как в списке. Приложение файл не удаляет.',
    }),
  );
  if (!app.session) {
    section.append(
      el('p', {
        class: 'hint',
        text: 'сначала разблокируйте: CSV собирается из расшифрованных записей',
      }),
    );
    const disabled = button('Скачать CSV (открытым текстом)', {
      kind: 'secondary',
    });
    disabled.disabled = true;
    section.append(el('div', { class: 'actions' }, disabled));
    return section;
  }
  const { input: agree, label } = checkbox(
    'csv-export-agree',
    'понимаю, что файл не зашифрован',
  );
  const download = button('Скачать CSV (открытым текстом)', {
    kind: 'secondary',
  });
  download.disabled = true;
  agree.addEventListener('change', () => {
    download.disabled = !agree.checked;
  });
  download.addEventListener('click', () => {
    const name = csvExportFilename();
    const text = csvExportText(app.session.entries);
    downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), name);
    app.toast(`CSV скачан: ${name}`);
  });
  section.append(label, el('div', { class: 'actions' }, download));
  return section;
}
