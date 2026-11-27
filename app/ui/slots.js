// 5 — способы входа и смена мастер-пароля (docs/ui.md §5.5).

import {
  el,
  heading,
  button,
  textButton,
  iconButton,
  banner,
  passwordField,
  labelFor,
  hint,
  dialogConfirm,
  downloadBlob,
  focusHeading,
} from './dom.js';
import { backIcon } from './icons.js';
import * as repo from '../lib/repo.js';
import {
  isUserCancelled,
  prfAddressError,
  setupPrfSlot,
  PASSKEY_MESSAGES,
} from '../lib/passkey.js';
import { needsRecoveryConfirmation, normalizeRecoveryConfirmed } from '../lib/recovery.js';
import { MAX_SLOTS } from '../../src/slots.js';

const KIND_LABEL = repo.SLOT_LABELS;

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

function askPassword(title) {
  return new Promise((resolve) => {
    let settled = false;
    const newId = 'ask-new-password';
    const repeatId = 'ask-repeat-password';
    const firstControl = passwordField(newId, {
      autocomplete: 'new-password',
    });
    const secondControl = passwordField(repeatId, {
      autocomplete: 'new-password',
    });
    const first = firstControl.input;
    const second = secondControl.input;
    const error = el('p', { class: 'error', role: 'status', hidden: true });
    const cancel = el('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: 'Отмена',
    });
    const okay = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Добавить' });
    const form = el(
      'form',
      { class: 'dialog-form', novalidate: true },
      el('div', { class: 'field' }, labelFor(newId, 'Новый пароль'), firstControl.node),
      el('div', { class: 'field' }, labelFor(repeatId, 'Повторите пароль'), secondControl.node, error),
      el('div', { class: 'dialog-actions' }, cancel, okay),
    );
    const dialog = el(
      'dialog',
      { class: 'dialog' },
      el('h2', { class: 'dialog-title', text: title }),
      form,
    );
    function finish(value) {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = first.value;
      if ([...value].length < 12) {
        error.hidden = false;
        error.textContent = 'пароль короче 12 символов';
        first.focus();
        return;
      }
      if (value !== second.value) {
        error.hidden = false;
        error.textContent = 'пароли не совпадают';
        second.focus();
        return;
      }
      finish(value);
    });
    document.body.append(dialog);
    dialog.showModal();
    first.focus();
  });
}

export function renderSlots(app, props = {}) {
  if (!app.session) {
    app.reset('unlock');
    return;
  }
  const page = el('div', { class: 'page' });
  const vault = app.vault;
  const slots = vault.slots;
  const entries = app.session.entries;
  const full = slots.length >= MAX_SLOTS;

  const back = iconButton('Назад к записям', '', () => app.back());
  back.replaceChildren(backIcon());
  page.append(
    el(
      'div',
      { class: 'screen-header' },
      back,
      heading('Способы входа'),
      el('span', { class: 'header-spacer' }),
    ),
  );

  const statusLine = el('div', { class: 'banner-slot' });
  page.append(statusLine);

  function showError(text) {
    statusLine.replaceChildren(banner(text, { danger: true }));
  }

  function focusSlot(id) {
    app.replace('slots', { focusSlotId: id });
  }

  async function confirmAndSave(
    slotCount,
    focusId,
    { stayOnCancel = false, recoveryConfirmed, render = true } = {},
  ) {
    const confirmed = await dialogConfirm({
      title: 'Смена набора способов входа',
      text:
        `В файл будет записан новый набор способов входа: ${slotCount} шт. ` +
        'Остальные записи не меняются',
      confirmLabel: 'Записать',
      cancelLabel: 'Отмена',
    });
    if (!confirmed) {
      // Экран кода при отмене остаётся на месте: уводить на список нельзя,
      // иначе код пропал бы, а слот остался бы в памяти.
      if (!stayOnCancel) {
        app.replace('slots', { focusSlotId: focusId, memoryOnly: true });
      }
      return false;
    }
    // Отметка «код записан» едет в файл тем же сохранением, что и набор.
    await app.saveEntries(entries, { acceptSlotSet: true, recoveryConfirmed });
    // Экран кода после успеха сам возвращается на предыдущий экран.
    if (render) app.replace('slots', { focusSlotId: focusId });
    return true;
  }

  async function confirmSlots(slotCount, focusId) {
    try {
      await confirmAndSave(slotCount, focusId);
    } catch (error) {
      showError(
        `не удалось записать файл: браузер не дал место. Изменения не ` +
          `сохранены — экспортируйте файл и повторите (${app.describeError(error)})`,
      );
    }
  }

  const list = el('div', { class: 'slot-list' });
  for (const slot of slots) {
    const status = slotStatus(app, slot);
    const lost = status === 'потерян';
    const row = el('div', { class: 'slot-item', 'data-slot-id': slot.id });
    const mark = textButton(lost ? 'Снять пометку' : 'Пометить потерянным', async () => {
      try {
        await app.writeSetting(`lost.${slot.id}`, lost ? undefined : true);
        if (lost) delete app.settings[`lost.${slot.id}`];
        else app.settings[`lost.${slot.id}`] = true;
        focusSlot(slot.id);
      } catch (error) {
        showError(`не удалось сохранить пометку: ${app.describeError(error)}`);
      }
    });
    mark.classList.add('slot-mark');

    const remove = textButton('Удалить', async () => {
      let next;
      try {
        next = repo.removeSlotFrom(app.vault, slot.id);
      } catch {
        return;
      }
      app.setVault(next);
      const rest = next.slots;
      const index = slots.findIndex((candidate) => candidate.id === slot.id);
      const focusId = rest[index] ? rest[index].id : rest[rest.length - 1]?.id;
      await confirmSlots(next.slots.length, focusId);
    });
    remove.classList.add('slot-delete');
    remove.disabled = slots.length === 1;
    if (remove.disabled) remove.setAttribute('aria-disabled', 'true');

    row.append(
      el(
        'div',
        { class: 'slot-head' },
        el(
          'div',
          { class: 'slot-text' },
          el('span', { class: 'slot-label', text: KIND_LABEL[slot.kind] ?? slot.kind }),
          el('span', { class: 'slot-id', text: `id ${slot.id.slice(0, 4)}` }),
        ),
        el(
          'span',
          {
            class: `status-pill${lost ? ' is-lost' : ''}${
              status === 'недоступен здесь' ? ' is-unavailable' : ''
            }`,
            text: status,
          },
        ),
      ),
      el('div', { class: 'slot-actions' }, mark, remove),
    );
    list.append(row);
  }
  page.append(list);

  if (needsRecoveryConfirmation({ slots }, app.session.recoveryConfirmed)) {
    page.append(
      el('p', {
        class: 'hint hint-sm',
        text:
          'код этого способа не подтверждён: если вы его не записали, ' +
          'удалите способ и добавьте новый',
      }),
    );
  }

  if (slots.length === 1) {
    page.append(
      hint('последний способ удалить нельзя: файл станет нечем открыть'),
    );
  }

  const addBlock = el('section', { class: 'section' }, el('h2', { class: 'h2', text: 'Добавить способ' }));
  const addRow = el('div', { class: 'actions' });

  const addPassword = button('Добавить пароль', {
    kind: 'secondary',
    onclick: async () => {
      const password = await askPassword('Новый способ входа паролем');
      if (password === null) return;
      const next = await repo.addPasswordSlot(vault, app.session.masterKey, password);
      app.setVault(next);
      const added = next.slots[next.slots.length - 1];
      await confirmSlots(next.slots.length, added.id);
    },
  });
  const addKeyfile = button('Добавить файл-ключ', {
    kind: 'secondary',
    onclick: async () => {
      const added = await repo.addKeyfileSlot(vault, app.session.masterKey);
      app.setVault(added.vault);
      downloadBlob(
        new Blob([added.key], { type: 'application/octet-stream' }),
        'kluchiki.key',
      );
      const slot = added.vault.slots[added.vault.slots.length - 1];
      await confirmSlots(added.vault.slots.length, slot.id);
    },
  });
  const hasRecovery = slots.some((slot) => slot.kind === 'recovery');
  const hasPrf = slots.some((slot) => slot.kind === 'prf');
  const addRecovery = button('Добавить код восстановления', {
    kind: 'secondary',
    onclick: async () => {
      const added = await repo.addRecoverySlot(vault, app.session.masterKey);
      app.setVault(added.vault);
      const slot = added.vault.slots[added.vault.slots.length - 1];
      app.navigate('recovery', {
        code: added.code,
        next: 'slots',
        unsavedCode: true,
        onContinue: async () => {
          const confirmed = normalizeRecoveryConfirmed(
            [...app.session.recoveryConfirmed, slot.id],
            added.vault.slots,
          );
          return confirmAndSave(added.vault.slots.length, slot.id, {
            stayOnCancel: true,
            recoveryConfirmed: confirmed,
            render: false,
          });
        },
      });
    },
  });
  const addPrf = button('Добавить отпечаток', {
    kind: 'secondary',
    onclick: async () => {
      addPrf.disabled = true;
      addPrf.textContent = 'Ждём подтверждения…';
      try {
        const added = await setupPrfSlot({
          vault,
          masterKey: app.session.masterKey,
          credentials: navigator.credentials,
          rpId: window.location.hostname,
          userName: 'kluchiki',
        });
        app.setVault(added.vault);
        await confirmSlots(added.vault.slots.length, added.slot.id);
      } catch (error) {
        addPrf.disabled = false;
        addPrf.textContent = 'Добавить отпечаток';
        if (isUserCancelled(error)) return;
        if (error && error.code === 'unsupported') {
          showError(PASSKEY_MESSAGES.unsupported);
          return;
        }
        if (error && error.code === 'unstable') {
          showError(error.message);
          return;
        }
        showError(`не удалось добавить отпечаток: ${app.describeError(error)}`);
      }
    },
  });

  if (full) {
    addRow.append(
      hint(`больше ${MAX_SLOTS} способов нельзя: удалите один, чтобы добавить другой`),
    );
    addPassword.disabled = true;
    addKeyfile.disabled = true;
    addRecovery.disabled = true;
    addPrf.disabled = true;
  } else {
    addRow.append(addPassword, addKeyfile);
    if (hasRecovery) addRow.append(hint('код уже создан; повторно он не показывается'));
    else addRow.append(addRecovery);
    if (hasPrf) addRow.append(hint('отпечаток уже добавлен; удалите его, чтобы добавить другой'));
    else addRow.append(addPrf);
  }
  addBlock.append(addRow);
  addBlock.append(
    hint(
      'Отпечаток привязан к устройству и аккаунту: если passkey ' +
        'синхронизируется, вход возможен и на других ваших устройствах',
    ),
    hint(
      'Файл-ключ скачивается один раз. Сохраните его отдельно: без него ' +
        'этот способ не сработает',
    ),
  );
  page.append(addBlock);

  const changeBlock = el(
    'section',
    { class: 'section' },
    el('h2', { class: 'h2', text: 'Сменить мастер-пароль' }),
  );
  const currentId = 'change-current';
  const nextId = 'change-next';
  const repeatId = 'change-repeat';
  const currentControl = passwordField(currentId, {
    autocomplete: 'current-password',
  });
  const nextControl = passwordField(nextId, {
    autocomplete: 'new-password',
  });
  const repeatControl = passwordField(repeatId, {
    autocomplete: 'new-password',
  });
  const currentInput = currentControl.input;
  const nextInput = nextControl.input;
  const repeatInput = repeatControl.input;
  const changeError = el('p', { class: 'error', role: 'status', hidden: true });
  const change = button('Сменить', { type: 'submit' });
  const changeForm = el(
    'form',
    { class: 'form', novalidate: true },
    el('div', { class: 'field' }, labelFor(currentId, 'Текущий'), currentControl.node),
    el(
      'div',
      { class: 'field' },
      labelFor(nextId, 'Новый'),
      nextControl.node,
      el('p', { class: 'counter', text: 'минимум 12 символов' }),
    ),
    el('div', { class: 'field' }, labelFor(repeatId, 'Повторите'), repeatControl.node, changeError),
    el('div', { class: 'actions' }, change),
  );
  changeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    changeError.hidden = true;
    if ([...nextInput.value].length < 12) {
      changeError.hidden = false;
      changeError.textContent = 'пароль короче 12 символов';
      nextInput.focus();
      return;
    }
    if (nextInput.value !== repeatInput.value) {
      changeError.hidden = false;
      changeError.textContent = 'пароли не совпадают';
      repeatInput.focus();
      return;
    }
    change.disabled = true;
    change.textContent = 'Меняем…';
    try {
      const nextVault = await repo.changeMasterPassword(
        app.vault,
        app.session.masterKey,
        currentInput.value,
        nextInput.value,
      );
      app.setVault(nextVault);
      await app.saveEntries(entries, { acceptSlotSet: true });
      currentInput.value = '';
      nextInput.value = '';
      repeatInput.value = '';
      app.toast('пароль изменён; остальные способы не тронуты');
      app.replace('slots');
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      changeError.hidden = false;
      if (message.includes('не удалось расшифровать')) {
        changeError.textContent =
          'не удалось расшифровать: пароль не подходит или файл изменён';
        currentInput.focus();
      } else {
        changeError.textContent =
          'не удалось записать файл: браузер не дал место. Изменения не ' +
          'сохранены — экспортируйте файл и повторите';
      }
      change.disabled = false;
      change.textContent = 'Сменить';
    }
  });
  changeBlock.append(changeForm);
  page.append(changeBlock);

  if (props.memoryOnly) {
    page.append(
      banner(
        'набор способов изменён только в памяти: запишите его на экране ' +
          'списка, иначе файл и заголовок разойдутся',
      ),
    );
  }

  app.cleanup = null;
  app.root.replaceChildren(page);
  const target = props.focusSlotId
    ? page.querySelector(`[data-slot-id="${props.focusSlotId}"] .slot-mark`)
    : null;
  if (target) target.focus();
  else focusHeading(page);
}
