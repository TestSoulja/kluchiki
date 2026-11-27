// 1б — хранилище заблокировано (docs/ui.md §5.1).

import {
  el,
  heading,
  button,
  textButton,
  labelFor,
  hint,
  passwordField,
  focusHeading,
} from './dom.js';
import * as repo from '../lib/repo.js';
import { parseRecoveryCode, prfSalt } from '../../src/slots.js';
import { orderSlots, pickDefaultSlot } from '../lib/unlock-order.js';
import {
  evaluatePrf,
  isUserCancelled,
  prfAddressError,
  PASSKEY_MESSAGES,
} from '../lib/passkey.js';

const SLOT_KIND_LABEL = repo.SLOT_LABELS;

function slotStatus(app, slot) {
  if (app.settings[`lost.${slot.id}`] === true) return 'потерян';
  if (slot.version !== 1) return 'недоступен здесь';
  if (slot.kind === 'prf') {
    return prfAddressError(slot, window.location.hostname)
      ? 'создан для другого адреса'
      : 'работает';
  }
  return 'работает';
}

export function renderUnlock(app, props = {}) {
  const root = app.root;
  const page = el('div', { class: 'page page-narrow' });
  const title = heading('Хранилище заблокировано');
  page.append(title);

  if (props.message) {
    page.append(el('p', { class: 'notice', role: 'status', text: props.message }));
  }
  if (props.lockedReason === 'idle') {
    page.append(
      el('p', {
        class: 'notice',
        text: 'Заблокировано автоматически: 5 минут без ввода',
      }),
    );
  }

  const slots = app.vault.slots;
  page.append(
    el('p', {
      class: 'subtitle',
      text: `Способов входа: ${slots.length}`,
    }),
  );

  const lost = (slot) => app.settings[`lost.${slot.id}`] === true;
  const hostname = window.location.hostname;
  let selected;
  if (Object.prototype.hasOwnProperty.call(props, 'selectedId')) {
    selected = props.selectedId;
  } else {
    selected = pickDefaultSlot(slots, { hostname, isLost: lost });
  }
  let focusTarget = null;

  for (const slot of orderSlots(slots, { hostname, isLost: lost })) {
    const status = slotStatus(app, slot);
    const available = status === 'работает';
    const panelId = `slot-panel-${slot.id}`;
    const row = el(
      'button',
      {
        type: 'button',
        class: `slot-row${selected === slot.id ? ' is-open' : ''}`,
        'aria-expanded': selected === slot.id ? 'true' : 'false',
        'aria-controls': panelId,
        disabled: !available,
      },
      el(
        'span',
        { class: 'slot-main' },
        el('span', { class: 'slot-label', text: SLOT_KIND_LABEL[slot.kind] ?? slot.kind }),
        el('span', { class: 'slot-sub', text: status }),
      ),
      available ? el('span', { class: 'chevron', text: '›' }) : null,
    );

    const panel = el('div', {
      class: 'slot-panel',
      id: panelId,
      hidden: selected !== slot.id,
    });
    if (!available) panel.hidden = true;

    row.addEventListener('click', () => {
      if (!available) return;
      app.replace('unlock', {
        ...props,
        selectedId: selected === slot.id ? null : slot.id,
      });
    });

    page.append(row, panel);
    if (!available) continue;

    if (slot.kind === 'password') {
      const inputId = `unlock-password-${slot.id}`;
      const { input, node } = passwordField(inputId, {
        autocomplete: 'current-password',
      });
      const error = el('p', { class: 'error', role: 'alert', hidden: true });
      const submit = button('Разблокировать', { type: 'submit' });
      const form = el(
        'form',
        { class: 'inline-form', novalidate: true },
        el('div', { class: 'field' }, labelFor(inputId, 'Мастер-пароль'), node, error),
        submit,
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (input.value === '') {
          error.hidden = false;
          error.textContent = 'не удалось расшифровать: пароль не подходит или файл изменён';
          input.focus();
          return;
        }
        submit.disabled = true;
        submit.textContent = 'Расшифровываем…';
        try {
          const opened = await repo.unlockWith(app.vault, {
            kind: 'password',
            secret: input.value,
            slotId: slot.id,
          });
          input.value = '';
          app.startSession(app.vault, opened);
          app.reset('list');
        } catch {
          input.value = '';
          error.hidden = false;
          error.textContent =
            'не удалось расшифровать: пароль не подходит или файл изменён';
          submit.disabled = false;
          submit.textContent = 'Разблокировать';
          input.focus();
        }
      });
      panel.append(form);
      if (selected === slot.id) focusTarget = input;
    } else if (slot.kind === 'recovery') {
      const inputId = `unlock-recovery-${slot.id}`;
      const input = el('input', {
        id: inputId,
        class: 'input',
        type: 'text',
        autocomplete: 'off',
        autocapitalize: 'characters',
        spellcheck: 'false',
        placeholder: 'XXXX-XXXX-XXXX-XXXX',
      });
      const error = el('p', { class: 'error', role: 'alert', hidden: true });
      const submit = button('Разблокировать', { type: 'submit' });
      const form = el(
        'form',
        { class: 'inline-form', novalidate: true },
        el('div', { class: 'field' }, labelFor(inputId, 'Код восстановления'), input, error),
        submit,
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        let secret;
        try {
          secret = parseRecoveryCode(input.value);
        } catch {
          error.hidden = false;
          error.textContent =
            'не удалось расшифровать: код не подходит или файл изменён';
          input.focus();
          return;
        }
        submit.disabled = true;
        submit.textContent = 'Расшифровываем…';
        try {
          const opened = await repo.unlockWith(app.vault, {
            kind: 'recovery',
            secret,
            slotId: slot.id,
          });
          input.value = '';
          app.startSession(app.vault, opened);
          app.reset('list');
        } catch {
          input.value = '';
          error.hidden = false;
          error.textContent =
            'не удалось расшифровать: код не подходит или файл изменён';
          submit.disabled = false;
          submit.textContent = 'Разблокировать';
          input.focus();
        }
      });
      panel.append(form);
      if (selected === slot.id) focusTarget = input;
    } else if (slot.kind === 'prf') {
      const error = el('p', { class: 'error', role: 'alert', hidden: true });
      const submit = button('Отпечаток');
      const note = hint(
        'Отпечаток привязан к устройству и аккаунту: если passkey ' +
          'синхронизируется, вход возможен и на других ваших устройствах',
      );
      const lostHint = hint(
        'если отпечаток больше не подходит, после входа удалите его на ' +
          'экране «Способы входа»',
      );
      lostHint.hidden = true;
      const markLost = button('Пометить потерянным', {
        kind: 'secondary',
        hidden: true,
      });
      markLost.addEventListener('click', async () => {
        try {
          await app.writeSetting(`lost.${slot.id}`, true);
        } catch {
          app.settings[`lost.${slot.id}`] = true;
        }
        app.replace('unlock', {
          message: `${PASSKEY_MESSAGES.wrong}: отпечаток помечен потерянным. Введите пароль`,
        });
      });
      const panelBox = el(
        'div',
        { class: 'inline-form' },
        note,
        el('div', { class: 'actions' }, submit),
        error,
        lostHint,
        el('div', { class: 'actions' }, markLost),
      );
      let tried = false;
      submit.addEventListener('click', async () => {
        if (tried) return;
        tried = true;
        submit.disabled = true;
        submit.textContent = 'Ждём…';
        error.hidden = true;
        let secret;
        try {
          secret = await evaluatePrf({
            credentials: navigator.credentials,
            credentialId: slot.prf.credentialId,
            salt: await prfSalt(slot.id),
            rpId: slot.prf.rpId,
          });
        } catch (failure) {
          if (isUserCancelled(failure)) {
            // Пользователь закрыл окно: это не ошибка, попытку не сжигаем.
            tried = false;
            submit.disabled = false;
            submit.textContent = 'Отпечаток';
            return;
          }
          error.hidden = false;
          error.textContent =
            failure && failure.code === 'unsupported'
              ? PASSKEY_MESSAGES.unsupported
              : `не удалось войти по отпечатку: ${app.describeError(failure)}`;
          submit.textContent = 'Отпечаток';
          return;
        }
        try {
          const opened = await repo.unlockWith(app.vault, {
            kind: 'prf',
            secret,
            slotId: slot.id,
          });
          app.startSession(app.vault, opened);
          app.reset('list');
        } catch {
          error.hidden = false;
          error.textContent = `${PASSKEY_MESSAGES.wrong}: введите пароль`;
          lostHint.hidden = false;
          markLost.hidden = false;
          submit.textContent = 'Отпечаток';
          const passwordSlot = slots.find((candidate) => candidate.kind === 'password');
          const passwordRow = passwordSlot
            ? page.querySelector(`[aria-controls="slot-panel-${passwordSlot.id}"]`)
            : null;
          if (passwordRow) passwordRow.focus();
        } finally {
          if (secret) secret.fill(0);
        }
      });
      panel.append(panelBox);
      if (selected === slot.id) focusTarget = submit;
    } else if (slot.kind === 'keyfile') {
      const error = el('p', { class: 'error', role: 'alert', hidden: true });
      const chosen = el('p', { class: 'hint', text: 'файл-ключ не выбран' });
      const fileInput = el('input', {
        type: 'file',
        class: 'file-input',
        id: `unlock-key-${slot.id}`,
      });
      const pick = el(
        'label',
        { class: 'btn btn-secondary', for: fileInput.id, text: 'Выбрать файл-ключ' },
      );
      const submit = button('Разблокировать', { type: 'submit' });
      submit.disabled = true;
      let keyBytes = null;
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
          keyBytes = null;
          chosen.textContent = 'файл-ключ не выбран';
          submit.disabled = true;
          return;
        }
        try {
          keyBytes = new Uint8Array(await file.arrayBuffer());
          chosen.textContent = `выбран файл: ${file.name}`;
          submit.disabled = false;
          error.hidden = true;
        } catch {
          keyBytes = null;
          chosen.textContent = 'файл-ключ не выбран';
          submit.disabled = true;
          error.hidden = false;
          error.textContent = 'не удалось прочитать файл-ключ';
        }
      });
      const form = el(
        'form',
        { class: 'inline-form', novalidate: true },
        el('div', { class: 'field' }, pick, fileInput, chosen, error),
        submit,
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!keyBytes) return;
        submit.disabled = true;
        submit.textContent = 'Расшифровываем…';
        try {
          const opened = await repo.unlockWith(app.vault, {
            kind: 'keyfile',
            secret: keyBytes,
            slotId: slot.id,
          });
          app.startSession(app.vault, opened);
          app.reset('list');
        } catch {
          error.hidden = false;
          error.textContent =
            'не удалось расшифровать: файл-ключ не подходит или файл изменён';
          submit.disabled = false;
          submit.textContent = 'Разблокировать';
          fileInput.value = '';
          keyBytes = null;
          chosen.textContent = 'файл-ключ не выбран';
        }
      });
      panel.append(form);
      if (selected === slot.id) focusTarget = fileInput;
    } else {
      // Незнакомый слот: показать его можно, открыть — нет.
      panel.append(
        hint(
          'этот способ создан другой версией приложения и здесь не открывается',
        ),
      );
    }
  }

  page.append(
    el('p', {
      class: 'text',
      text:
        'Если способ потерян — выберите другой. Если потеряны все — код ' +
        'восстановления; без кода данных нет',
    }),
  );
  page.append(
    textButton('Импортировать файл', () => app.navigate('transfer')),
  );
  page.append(
    el(
      'p',
      { class: 'text about-link' },
      el('a', { href: './about.html', text: 'О приложении' }),
    ),
  );
  page.append(
    el('p', {
      class: 'hint',
      text:
        'PBKDF2-HMAC-SHA256, 600 000 итераций; 64,7 мс на машине замера; ' +
        'на телефоне не измерено',
    }),
  );

  root.replaceChildren(page);

  if (focusTarget) {
    focusTarget.focus();
  } else {
    const availableRow = [...page.querySelectorAll('.slot-row')].find(
      (row) => !row.disabled,
    );
    if (availableRow) availableRow.focus();
    else focusHeading(page);
  }
}
