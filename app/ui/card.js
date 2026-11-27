// 3 — карточка записи и её подсостояние создания/правки
// (docs/ui.md §5.3, §5.3.1).

import {
  el,
  heading,
  button,
  textButton,
  iconButton,
  menu,
  banner,
  field,
  passwordField,
  labelFor,
  dialogConfirm,
  formatDate,
  focusHeading,
} from './dom.js';
import { backIcon, copyIcon, eyeIcon, eyeOffIcon } from './icons.js';
import * as repo from '../lib/repo.js';

const DOTS = '••••••••';

function emptyDraft() {
  return { title: '', login: '', password: '', url: '', notes: '', tags: '' };
}

function draftFromEntry(entry) {
  return {
    title: entry.title,
    login: entry.login,
    password: entry.password,
    url: entry.url,
    notes: entry.notes,
    tags: entry.tags.join(', '),
  };
}

function headerWithBack(titleText, onBack, extra = null) {
  const back = iconButton('Назад к записям', '', onBack);
  back.replaceChildren(backIcon());
  return el(
    'div',
    { class: 'screen-header' },
    back,
    heading(titleText),
    extra ?? el('span', { class: 'header-spacer' }),
  );
}

export function renderCard(app, props = {}) {
  if (!app.session) {
    app.reset('unlock');
    return;
  }
  const isNew = props.isNew === true;
  if (props.mode === 'edit' || isNew) {
    renderEdit(app, props);
    return;
  }
  const entry = isNew
    ? null
    : app.session.entries.find((candidate) => candidate.id === props.entryId);
  if (!isNew && !entry) {
    app.replace('list');
    return;
  }
  renderView(app, entry);
}

async function deleteEntry(app, entry) {
  const confirmed = await dialogConfirm({
    title: 'Удалить запись',
    text: `Удалить запись «${entry.title}»? Это действие нельзя отменить`,
    confirmLabel: 'Удалить',
    cancelLabel: 'Отмена',
    danger: true,
  });
  if (!confirmed) return false;
  const entries = app.session.entries.filter((candidate) => candidate.id !== entry.id);
  try {
    await app.saveEntries(entries);
    app.reset('list');
    return true;
  } catch (error) {
    app.toast(app.describeSaveError(error));
    return false;
  }
}

function renderView(app, entry) {
  const page = el('div', { class: 'page' });

  const more = menu('Ещё', [
    {
      label: 'Изменить',
      run: () => app.navigate('card', { entryId: entry.id, mode: 'edit' }),
    },
    {
      label: 'Удалить',
      run: () => {
        void deleteEntry(app, entry);
      },
    },
  ]);

  const header = headerWithBack(entry.title, () => app.back({ focusEntry: entry.id }), more);
  page.append(header);

  const card = el('div', { class: 'card' });
  const rows = [];

  const shownHint = el('p', {
    class: 'hint',
    hidden: true,
    text:
      'выделенное с клавиатуры копируется без автоочистки — это обычное ' +
      'копирование браузера',
  });

  function updateHint() {
    shownHint.hidden = !rows.some((row) => row.shown());
  }

  // У каждой строки свой глазок и своё автоскрытие 60 с (docs/ui.md §5.3).
  function makeRow(labelText, value, { copy = null, mono = false, notes = false } = {}) {
    const valueNode = el('span', {
      class: `${notes ? 'value value-notes' : 'value'}${mono ? ' mono' : ''}`,
      text: DOTS,
    });
    const line = el('span', { class: 'value-line' }, valueNode);
    const name = labelText.toLowerCase();
    let shown = false;
    let timer = null;

    const eye = el(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        'aria-pressed': 'false',
        'aria-label': `Показать ${name}`,
        title: `Показать ${name}`,
      },
      eyeIcon(),
    );

    function apply(next) {
      shown = next;
      valueNode.textContent = next ? (value === '' ? '—' : value) : DOTS;
      const label = next ? `Скрыть ${name}` : `Показать ${name}`;
      eye.setAttribute('aria-pressed', next ? 'true' : 'false');
      eye.setAttribute('aria-label', label);
      eye.title = label;
      eye.replaceChildren(next ? eyeOffIcon() : eyeIcon());
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (next) {
        timer = setTimeout(() => {
          timer = null;
          apply(false);
        }, 60 * 1000);
      }
      updateHint();
    }

    eye.addEventListener('click', () => apply(!shown));
    line.append(eye);

    if (copy) {
      const copyButton = iconButton(`Копировать ${copy}`, '', async () => {
        await app.clipboard.copy(value, copy);
      });
      copyButton.replaceChildren(copyIcon());
      line.append(copyButton);
    }

    rows.push({
      shown: () => shown,
      hide: () => apply(false),
      stop: () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      },
    });

    return el(
      'div',
      { class: 'value-row' },
      el('span', { class: 'value-label', text: labelText }),
      line,
    );
  }

  card.append(
    makeRow('Логин', entry.login, { copy: 'логин' }),
    makeRow('Пароль', entry.password, { copy: 'пароль', mono: true }),
    makeRow('Адрес', entry.url, { copy: 'адрес' }),
    makeRow('Заметки', entry.notes, { copy: 'заметки', notes: true }),
    el(
      'div',
      { class: 'value-row' },
      el('span', { class: 'value-label', text: 'Теги' }),
      el('span', {
        class: 'value',
        text: entry.tags.length > 0 ? entry.tags.join(', ') : '—',
      }),
    ),
    el(
      'div',
      { class: 'value-row' },
      el('span', { class: 'value-label', text: 'Изменено' }),
      el('span', { class: 'value', text: formatDate(entry.updatedAt) }),
    ),
  );
  page.append(card, shownHint);

  app.cleanup = () => {
    for (const row of rows) row.stop();
  };
  app.root.replaceChildren(page);
  focusHeading(page);
}

function renderEdit(app, props) {
  const isNew = props.isNew === true;
  const entry = isNew
    ? null
    : app.session.entries.find((candidate) => candidate.id === props.entryId);
  if (!isNew && !entry) {
    app.replace('list');
    return;
  }

  const initial = props.draft ?? (entry ? draftFromEntry(entry) : emptyDraft());
  const page = el('div', { class: 'page' });

  const back = iconButton('Отмена', '', () => app.back());
  back.replaceChildren(backIcon());

  const header = el(
    'div',
    { class: 'screen-header' },
    back,
    heading(isNew ? 'Новая запись' : 'Правка записи'),
    el('span', { class: 'header-spacer' }),
  );
  page.append(header);

  const errorBanner = el('div', { class: 'banner-slot' });
  page.append(errorBanner);

  const titleId = 'edit-title';
  const loginId = 'edit-login';
  const passwordId = 'edit-password';
  const urlId = 'edit-url';
  const notesId = 'edit-notes';
  const tagsId = 'edit-tags';

  const titleInput = field(titleId, 'Заголовок', {
    type: 'text',
    maxlength: '200',
    autocomplete: 'off',
    value: initial.title,
  });
  const titleError = el('p', { class: 'error', role: 'status', hidden: true });
  const loginInput = field(loginId, 'Логин', {
    type: 'text',
    autocomplete: 'off',
    value: initial.login,
  });
  const passwordControl = passwordField(passwordId, {
    autocomplete: 'new-password',
    value: initial.password,
  });
  const passwordInput = passwordControl.input;
  const generate = textButton('Сгенерировать', () => {
    app.navigate('generator', {
      draft: collect(),
      entryId: entry ? entry.id : null,
      isNew,
    });
  });
  passwordControl.node.append(generate);
  const urlInput = field(urlId, 'Адрес', {
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    value: initial.url,
  });
  const notesInput = el('textarea', {
    id: notesId,
    class: 'input textarea',
    rows: '6',
    text: initial.notes,
  });
  const tagsInput = field(tagsId, 'Теги', {
    type: 'text',
    autocomplete: 'off',
    value: initial.tags,
  });

  function collect() {
    return {
      title: titleInput.value,
      login: loginInput.value,
      password: passwordInput.value,
      url: urlInput.value,
      notes: notesInput.value,
      tags: tagsInput.value,
    };
  }

  const save = button('Сохранить', { type: 'submit' });
  const cancel = button('Отмена', {
    kind: 'secondary',
    onclick: () => app.back(),
  });
  const actions = el('div', { class: 'actions' }, save, cancel);

  let removeButton = null;
  if (entry) {
    removeButton = button('Удалить', { kind: 'danger-text' });
    removeButton.addEventListener('click', () => {
      void deleteEntry(app, entry);
    });
    actions.append(removeButton);
  }

  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el(
      'div',
      { class: 'field' },
      labelFor(titleId, 'Заголовок'),
      titleInput,
      titleError,
    ),
    el('div', { class: 'field' }, labelFor(loginId, 'Логин'), loginInput),
    el(
      'div',
      { class: 'field' },
      labelFor(passwordId, 'Пароль'),
      passwordControl.node,
    ),
    el('div', { class: 'field' }, labelFor(urlId, 'Адрес'), urlInput),
    el('div', { class: 'field' }, labelFor(notesId, 'Заметки'), notesInput),
    el('div', { class: 'field' }, labelFor(tagsId, 'Теги'), tagsInput),
    el('p', {
      class: 'hint',
      text: 'теги — через запятую; адрес не проверяется на формат',
    }),
    actions,
  );

  titleInput.addEventListener('input', () => {
    titleError.hidden = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = collect();
    const error = repo.titleError(fields.title);
    if (error) {
      titleError.hidden = false;
      titleError.textContent = error;
      titleInput.focus();
      return;
    }
    save.disabled = true;
    save.textContent = 'Сохраняем…';
    try {
      let savedEntry;
      let entries;
      if (entry) {
        savedEntry = repo.updateEntry(entry, fields);
        entries = app.session.entries.map((candidate) =>
          candidate.id === entry.id ? savedEntry : candidate,
        );
      } else {
        savedEntry = repo.makeEntry(fields);
        entries = [...app.session.entries, savedEntry];
      }
      await app.saveEntries(entries, { entrySaved: true });
      if (entry) app.back();
      else app.replace('card', { entryId: savedEntry.id });
    } catch (failure) {
      save.disabled = false;
      save.textContent = 'Сохранить';
      errorBanner.replaceChildren(
        banner(app.describeSaveError(failure), { danger: true }),
      );
    }
  });

  page.append(form);
  app.cleanup = null;
  app.root.replaceChildren(page);
  titleInput.focus();
}
