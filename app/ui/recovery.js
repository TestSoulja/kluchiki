// 6 — код восстановления (docs/ui.md §5.6). Код показывается один раз:
// после «Продолжить» узлы кода удаляются из DOM, а строка из памяти экрана.

import {
  el,
  heading,
  button,
  textButton,
  checkbox,
  hint,
  focusHeading,
} from './dom.js';
import { finishRecovery, normalizeRecoveryConfirmed, recoveryReminder } from '../lib/recovery.js';
import * as repo from '../lib/repo.js';

export function renderRecovery(app, props = {}) {
  const root = app.root;
  let code = String(props.code ?? '');
  const page = el('div', { class: 'page page-narrow' });
  const title = heading('Код восстановления');

  const intro = el('p', {
    class: 'text',
    text:
      'Этот код показывается один раз и не хранится в файле в открытом виде. ' +
      'Запишите его на бумагу или вставьте в свой менеджер',
  });

  const block = el('div', {
    class: 'code',
    tabindex: '0',
    role: 'group',
    'aria-label': 'код восстановления, 32 символа, 8 групп',
  });
  const groups = code.split('-');
  for (const group of groups) {
    block.append(el('span', { class: 'code-cell', text: group }));
  }

  const copied = el('p', { class: 'hint', hidden: true });
  const copyButton = button('Копировать код', { kind: 'secondary' });
  copyButton.addEventListener('click', async () => {
    const value = code;
    if (!value) return;
    const ok = await app.clipboard.copy(
      value,
      'Код',
      'не удалось скопировать: выделите код и нажмите Ctrl+C',
    );
    copied.hidden = ok;
    if (!ok) copied.textContent = 'выделите код и нажмите Ctrl+C';
  });

  const selectButton = textButton('Выделить всё', () => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(block);
    selection.removeAllRanges();
    selection.addRange(range);
    block.focus();
  });

  const { input: agree, label: agreeLabel } = checkbox(
    'recovery-agree',
    'Я записал код',
  );
  const warning = hint(
    'код не хранится в файле в открытом виде: если закрыть эту страницу, ' +
      'он больше не появится',
  );
  // Для кода, добавленного из слотов, способ ещё не в файле: он
  // записывается только по «Продолжить». При создании хранилища слот
  // уже записан, поэтому строка не показывается.
  const notSaved =
    props.first === true
      ? null
      : el('p', {
          class: 'hint hint-sm',
          text: 'если закрыть эту страницу, способ не добавится',
        });
  const submit = button('Продолжить', { type: 'submit' });
  submit.disabled = true;
  // После «Отмены» в диалоге записи экран перерисовывается: галочка
  // «Я записал код» сохраняется, «Продолжить» снова активна.
  if (props.agreed === true) {
    agree.checked = true;
    submit.disabled = false;
  }
  agree.addEventListener('change', () => {
    submit.disabled = !agree.checked;
  });

  // Через 10 минут от входа (Date.now, не тики) появляется подсказка и
  // выход «не добавлять способ» (docs/ui.md §5.6). Это не отмена диалога
  // записи: способ из памяти убирается, файл и сессия приводятся в согласие.
  const reminder = el('div', { hidden: true });
  reminder.append(
    el('p', {
      class: 'hint',
      text:
        'код на экране уже 10 минут — запишите его и нажмите „Продолжить“',
    }),
  );
  const exitButton = textButton('не добавлять способ', () => {
    void leaveWithoutSaving();
  });
  reminder.append(el('div', { class: 'actions' }, exitButton));

  const formError = el('p', { class: 'error', role: 'status', hidden: true });

  const enteredAt = Date.now();
  let reminderTimer = null;
  function checkReminder() {
    if (!recoveryReminder(Date.now() - enteredAt)) return;
    reminder.hidden = false;
    if (reminderTimer !== null) {
      clearInterval(reminderTimer);
      reminderTimer = null;
    }
  }
  reminderTimer = setInterval(checkReminder, 1000);
  checkReminder();

  function clearCode() {
    block.replaceChildren();
    code = '';
    props.code = null;
    props.unsavedCode = false;
  }

  // Перечитывает файл: после выхода код не должен остаться ни в памяти,
  // ни в наборе способов. Записи сессии не меняются — они и лежат в файле.
  async function rereadFromFile() {
    const text = await app.store.readVault();
    if (typeof text !== 'string') throw new Error('файл хранилища не найден');
    const vault = repo.parseVault(text);
    app.vaultText = text;
    app.vault = vault;
    app.vaultLoadError = null;
    if (app.session) {
      app.session.slotIds = vault.slots.map((slot) => slot.id);
      app.session.slotSetMismatch = null;
      app.session.recoveryConfirmed = normalizeRecoveryConfirmed(
        app.session.recoveryConfirmed,
        vault.slots,
      );
    }
  }

  async function leaveWithoutSaving() {
    exitButton.disabled = true;
    exitButton.textContent = 'Читаем…';
    formError.hidden = true;
    try {
      if (typeof props.onContinue === 'function') {
        // (а) Код добавлен из списка: в файле слота ещё нет, достаточно
        // перечитать файл — способ и подтверждение исчезнут из памяти.
        await rereadFromFile();
      } else if (props.confirmedSlotId && app.session) {
        // (б) Создание: слот уже в файле. Сначала сохраняем набор без него
        // (иначе в файле останется способ, кода от которого ни у кого нет),
        // потом перечитываем файл.
        const slots = app.vault.slots.filter(
          (slot) => slot.id !== props.confirmedSlotId,
        );
        if (slots.length === 0) {
          throw new Error('последний способ удалить нельзя');
        }
        app.vault = { ...app.vault, slots };
        await app.saveEntries(app.session.entries, {
          acceptSlotSet: true,
          recoveryConfirmed: normalizeRecoveryConfirmed(
            app.session.recoveryConfirmed,
            slots,
          ),
        });
        await rereadFromFile();
      } else {
        await rereadFromFile();
      }
      clearCode();
      app.toast('код не добавлен; хранилище прочитано из файла заново');
      // Возвращаемся на экран, откуда пришли: список после создания или
      // слоты, если код добавляли оттуда.
      app.back();
    } catch (error) {
      formError.hidden = false;
      formError.textContent = app.describeError(error);
      exitButton.disabled = false;
      exitButton.textContent = 'не добавлять способ';
    }
  }

  const form = el(
    'form',
    { class: 'form', novalidate: true },
    block,
    el('div', { class: 'actions' }, copyButton, selectButton),
    agreeLabel,
    warning,
    notSaved,
    reminder,
    el('div', { class: 'actions' }, submit),
    formError,
    el('p', {
      class: 'hint',
      text:
        'Можно хранить этот код отдельно от файла-ключа: он открывает ' +
        'хранилище, если потеряны остальные способы',
    }),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!agree.checked) return;
    submit.disabled = true;
    submit.textContent = 'Продолжаем…';
    formError.hidden = true;
    try {
      const done = await finishRecovery(props, async () => {
        if (typeof props.onContinue === 'function') {
          // Способ, добавленный из слотов, пишется в файл только здесь;
          // подтверждение кода пишет сам обработчик до отрисовки списка.
          // Отмена диалога записи (false) код не подтверждает.
          return await props.onContinue();
        }
        // При создании хранилища слот уже в файле; подтверждение пишется
        // в тело тем же сохранением до перехода, чтобы сорванная запись
        // оставила код на экране.
        if (props.confirmedSlotId && app.session) {
          const confirmed = normalizeRecoveryConfirmed(
            [...app.session.recoveryConfirmed, props.confirmedSlotId],
            app.vault.slots,
          );
          await app.saveEntries(app.session.entries, {
            recoveryConfirmed: confirmed,
          });
        }
        return true;
      });
      if (done === false) {
        // «Отмена»: тот же код, тот же экран, способ не записан.
        props.agreed = true;
        app.replace('recovery', props);
        return;
      }
      // Код убирается из DOM и из памяти экрана после успешного перехода.
      block.replaceChildren();
      code = '';
      props.code = null;
      // Из слотов возвращаемся на них; после создания список — корень.
      if (typeof props.onContinue === 'function') app.back();
      else app.reset(props.next ?? 'list');
    } catch (error) {
      formError.hidden = false;
      formError.textContent = app.describeError(error);
      submit.disabled = false;
      submit.textContent = 'Продолжить';
    }
  });

  page.append(title, intro, form, copied);
  app.cleanup = () => {
    if (reminderTimer !== null) {
      clearInterval(reminderTimer);
      reminderTimer = null;
    }
  };
  root.replaceChildren(page);
  focusHeading(page);
}
