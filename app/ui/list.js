// 2 — список записей (docs/ui.md §5.2).

import {
  el,
  heading,
  button,
  textButton,
  menu,
  banner,
} from './dom.js';
import { filterEntries, countLabel } from '../lib/search.js';
import { exportReminder, needsExportLink } from '../lib/backup.js';

function slotMismatchText(session) {
  const mismatch = session ? session.slotSetMismatch : null;
  if (!mismatch) return null;
  const parts = [];
  if (mismatch.missing.length > 0) {
    parts.push(`пропали ${mismatch.missing.map((id) => id.slice(0, 4)).join(', ')}`);
  }
  if (mismatch.extra.length > 0) {
    parts.push(`появились ${mismatch.extra.map((id) => id.slice(0, 4)).join(', ')}`);
  }
  if (parts.length === 0) return null;
  return (
    `Файл помнит другой набор способов входа: ${parts.join('; ')}. ` +
    'Пока набор не записан, изменения останутся только в памяти'
  );
}

export function renderList(app, props = {}) {
  const page = el('div', { class: 'page page-list' });
  const session = app.session;
  if (!session) {
    app.reset('unlock');
    return;
  }

  const entries = session.entries;
  let query = app.listQuery ?? '';

  const title = heading('Записи');
  const addButton = button('Добавить', {
    onclick: () => app.navigate('card', { isNew: true }),
  });
  const headerActions = el('div', { class: 'header-actions' });
  if (entries.length > 0) headerActions.append(addButton);
  headerActions.append(
    menu('Ещё', [
      { label: 'Когда записи пропадут', run: () => app.navigate('loss') },
      { label: 'Способы входа', run: () => app.navigate('slots') },
      { label: 'Экспорт и импорт', run: () => app.navigate('transfer') },
      { label: 'Стереть всё', run: () => app.navigate('erase') },
      { label: 'Заблокировать', run: () => app.lock('manual') },
    ]),
  );
  const header = el(
    'div',
    { class: 'screen-header' },
    title,
    headerActions,
  );
  page.append(header);

  const mismatchText = slotMismatchText(session);
  if (mismatchText) {
    const fix = button('Записать текущий набор', { kind: 'secondary' });
    fix.addEventListener('click', async () => {
      fix.disabled = true;
      fix.textContent = 'Записываем…';
      try {
        await app.saveEntries(entries, { acceptSlotSet: true });
        app.replace('list', { focusEntry: props.focusEntry });
      } catch (error) {
        app.toast(app.describeError(error));
        fix.disabled = false;
        fix.textContent = 'Записать текущий набор';
      }
    });
    page.append(
      banner(mismatchText, { action: fix }),
    );
  }

  if (app.persistRefused) {
    const retry = button('Повторить', { kind: 'secondary' });
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      await app.requestPersist();
      app.replace('list');
    });
    page.append(
      banner(
        // ui.md §5.2/§7 и plan.md §6 говорят об одном: фраза плана
        // («может удалить данные при нехватке места») добавлена в текст.
        'браузер не обещает хранить данные: они могут исчезнуть при ' +
          'очистке, а браузер может удалить данные при нехватке места. ' +
          'Экспортируйте файл',
        { danger: true, action: retry },
      ),
    );
  }

  const searchId = 'entry-search';
  const search = el('input', {
    id: searchId,
    type: 'search',
    class: 'input search-input',
    placeholder: 'Поиск: заголовок, логин, адрес, метки',
    'aria-label': 'Поиск записей: заголовок, логин, адрес, метки',
    value: query,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const counter = el('p', { class: 'counter', 'aria-live': 'polite' });
  const content = el('div', { class: 'list-content' });

  function rowFor(entry) {
    const row = el(
      'button',
      {
        type: 'button',
        class: 'row',
        'data-entry-id': entry.id,
        onclick: () => app.navigate('card', { entryId: entry.id }),
      },
      el('span', { class: 'row-title', text: entry.title }),
      el('span', { class: 'chevron', text: '›', 'aria-hidden': 'true' }),
    );
    return row;
  }

  function update() {
    const found = filterEntries(entries, query);
    counter.textContent = countLabel(entries.length, found.length, query);
    content.replaceChildren();

    if (entries.length === 0) {
      const block = el('div', { class: 'empty' });
      block.append(
        el('p', {
          class: 'text muted',
          text: 'Записей нет. Добавьте первую — она сохранится в этом браузере',
        }),
        button('Добавить запись', {
          onclick: () => app.navigate('card', { isNew: true }),
        }),
      );
      content.append(block);
      return;
    }

    if (found.length === 0) {
      const block = el('div', { class: 'empty' });
      const clear = textButton('Очистить поиск', () => {
        search.value = '';
        query = '';
        app.listQuery = '';
        update();
        search.focus();
      });
      block.append(
        el('p', {
          class: 'text muted',
          text: `Ничего не найдено по «${query.trim()}»`,
        }),
        clear,
      );
      content.append(block);
      return;
    }

    const list = el('div', { class: 'list' });
    for (const entry of found) {
      list.append(rowFor(entry));
    }
    content.append(list);
  }

  search.addEventListener('input', () => {
    query = search.value;
    app.listQuery = query;
    update();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      search.value = '';
      query = '';
      app.listQuery = '';
      update();
    }
  });

  const lossLink = textButton('Когда записи пропадут', () =>
    app.navigate('loss'),
  );
  lossLink.classList.add('loss-entry');

  page.append(
    el('div', { class: 'field search-field' }, search),
    counter,
    lossLink,
    el('p', { class: 'hint', text: exportReminder(app.settings) }),
  );
  if (needsExportLink(app.settings)) {
    page.append(
      el(
        'div',
        { class: 'actions' },
        textButton('Экспорт и импорт', () => app.navigate('transfer')),
      ),
    );
  }
  page.append(content);
  app.root.replaceChildren(page);
  update();

  if (props.focusEntry) {
    const row = page.querySelector(`[data-entry-id="${props.focusEntry}"]`);
    if (row) {
      row.focus();
      return;
    }
  }
  search.focus();
}
