// 8 — «стереть всё» (docs/ui.md §5.8).

import {
  el,
  heading,
  button,
  textButton,
  iconButton,
  labelFor,
  hint,
  field,
} from './dom.js';
import { backIcon } from './icons.js';
import { isEraseConfirmed } from '../lib/erase.js';
import { CLEAR_REFUSED } from '../lib/clipboard.js';

export function renderErase(app) {
  if (!app.session) {
    app.reset('unlock');
    return;
  }
  const page = el('div', { class: 'page page-narrow' });

  const back = iconButton('Назад к записям', '', () => app.back());
  back.replaceChildren(backIcon());
  page.append(
    el(
      'div',
      { class: 'screen-header' },
      back,
      heading('Стереть всё'),
      el('span', { class: 'header-spacer' }),
    ),
  );

  const panel = el(
    'div',
    { class: 'danger-panel' },
    el('p', {
      class: 'text',
      text:
        'Будут удалены: хранилище в этом браузере, все записи, способы ' +
        'входа и настройки. Буфер обмена приложение попробует очистить, ' +
        'если браузер разрешит. Файлы, которые вы скачали, и код на ' +
        'бумаге останутся',
    }),
  );

  const inputId = 'erase-word';
  const word = field(inputId, 'Введите СТЕРЕТЬ', {
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    'aria-describedby': 'erase-hint',
  });
  const error = el('p', { class: 'error', role: 'status', hidden: true });
  const cancel = button('Отмена', {
    kind: 'secondary',
    onclick: () => app.back(),
  });
  const erase = button('Стереть', { kind: 'danger' });
  erase.disabled = true;

  function update() {
    erase.disabled = !isEraseConfirmed(word.value);
  }
  word.addEventListener('input', update);

  erase.addEventListener('click', async () => {
    if (!isEraseConfirmed(word.value)) return;
    erase.disabled = true;
    erase.textContent = 'Стираем…';
    error.hidden = true;
    // Буфер очищается до удаления: отказ не мешает стереть данные,
    // но и не скрывается (docs/ui.md §5.8).
    const hadCopied = app.clipboard.active;
    const cleared = await app.clipboard.clearNow({ quiet: true });
    try {
      await app.store.clearAll();
    } catch (failure) {
      error.hidden = false;
      error.textContent =
        `не удалось удалить данные: ${app.describeError(failure)}. ` +
        'Закройте другие вкладки приложения и повторите';
      erase.disabled = false;
      erase.textContent = 'Стереть';
      return;
    }
    app.wipeSession();
    app.vault = null;
    app.vaultText = undefined;
    app.settings = {};
    app.persistRefused = false;
    app.listQuery = '';
    app.reset('create', { message: 'Локальные данные удалены' });
    if (hadCopied && !cleared) app.toast(CLEAR_REFUSED);
  });

  page.append(
    panel,
    el(
      'div',
      { class: 'actions' },
      textButton('Что ещё стирает записи', () => app.navigate('loss')),
    ),
    el(
      'div',
      { class: 'form' },
      el('div', { class: 'field' }, labelFor(inputId, 'Введите СТЕРЕТЬ'), word),
      hint('регистр не важен; слово кириллицей', 'erase-hint'),
      error,
      el('div', { class: 'actions stacked' }, cancel, erase),
    ),
  );
  page.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      app.back();
    }
  });

  app.cleanup = null;
  app.root.replaceChildren(page);
  word.focus();
}
