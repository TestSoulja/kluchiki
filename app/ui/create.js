// 1а — хранилища нет (docs/ui.md §5.1).

import {
  el,
  heading,
  button,
  checkbox,
  banner,
  labelFor,
  passwordField,
  focusHeading,
} from './dom.js';
import * as repo from '../lib/repo.js';
import { canOfferPasskey } from '../lib/passkey.js';

const DB_ERROR =
  'браузер не дал локальное хранилище (IndexedDB). Закройте приватное ' +
  'окно или разрешите данные сайта и перезагрузите страницу';

export function renderCreate(app, props = {}) {
  const root = app.root;
  const noStorage = Boolean(app.storeError);
  const page = el('div', { class: 'page page-narrow' });
  const title = heading('Kluchiki');
  page.append(
    title,
    el('p', {
      class: 'subtitle',
      text: props.message ?? 'Хранилища на этом устройстве нет',
    }),
  );

  if (app.storeError) {
    page.append(banner(DB_ERROR, { danger: true }));
  }
  if (app.vaultLoadError) {
    page.append(
      banner(
        `хранилище в браузере не разобралось: ${app.vaultLoadError}. ` +
          'Импортируйте файл, если он у вас есть, или создайте новое ' +
          'хранилище — старое при этом будет заменено',
        { danger: true },
      ),
    );
  }

  const intro = el('p', {
    class: 'text',
    text:
      'Новое хранилище создаётся здесь и остаётся в этом браузере. ' +
      'Мастер-пароль не хранится нигде: если забыть его и потерять код ' +
      'восстановления, данных не будет',
  });
  const about = el(
    'p',
    { class: 'text about-link' },
    el('a', { href: './about.html', text: 'Что это и чего нет' }),
  );

  const passwordId = 'create-password';
  const repeatId = 'create-repeat';
  const agreeId = 'create-agree';

  const passwordControl = passwordField(passwordId, {
    autocomplete: 'new-password',
  });
  const repeatControl = passwordField(repeatId, {
    autocomplete: 'new-password',
  });
  const password = passwordControl.input;
  const repeat = repeatControl.input;
  const counter = el('p', { class: 'counter', text: '0 / 12' });
  const passwordError = el('p', { class: 'error', role: 'status', hidden: true });
  const repeatError = el('p', { class: 'error', role: 'status', hidden: true });
  const { input: agree, label: agreeLabel } = checkbox(
    agreeId,
    'Я понимаю: если забыть пароль и потерять код восстановления, данных не будет',
  );
  const submit = button('Создать хранилище', { type: 'submit' });
  const importLink = el(
    'button',
    {
      type: 'button',
      class: 'btn btn-text',
      text: 'У меня уже есть файл хранилища',
      disabled: noStorage,
    },
  );
  importLink.addEventListener('click', () => app.navigate('transfer'));

  const footer = el('p', {
    class: 'hint',
    text:
      'PBKDF2-HMAC-SHA256, 600 000 итераций; 64,7 мс на машине замера; ' +
      'на телефоне не измерено',
  });

  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el(
      'div',
      { class: 'field' },
      labelFor(passwordId, 'Мастер-пароль'),
      passwordControl.node,
      counter,
      passwordError,
    ),
    el(
      'div',
      { class: 'field' },
      labelFor(repeatId, 'Повторите пароль'),
      repeatControl.node,
      repeatError,
    ),
    agreeLabel,
    el('div', { class: 'actions' }, submit),
    importLink,
    footer,
  );

  function update() {
    const length = [...password.value].length;
    counter.textContent = `${length} / 12`;
    counter.classList.toggle('is-short', length < 12);
    const bothFilled = repeat.value !== '';
    const same = repeat.value === password.value;
    repeatError.hidden = !(bothFilled && !same);
    repeatError.textContent = bothFilled && !same ? 'пароли не совпадают' : '';
    const ready =
      length >= 12 &&
      same &&
      repeat.value !== '' &&
      agree.checked &&
      !noStorage;
    submit.disabled = !ready;
    if (length >= 12) passwordError.hidden = true;
  }

  for (const node of [password, repeat]) node.addEventListener('input', update);
  agree.addEventListener('change', update);
  update();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (noStorage) return;
    const length = [...password.value].length;
    if (length < 12) {
      passwordError.hidden = false;
      passwordError.textContent = 'пароль короче 12 символов';
      password.focus();
      return;
    }
    if (password.value !== repeat.value) {
      repeatError.hidden = false;
      repeatError.textContent = 'пароли не совпадают';
      repeat.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Создаём…';
    try {
      const created = await repo.createVaultWithRecovery(password.value);
      await app.store.writeVault(created.text);
      app.vaultText = created.text;
      app.vault = created.vault;
      app.vaultLoadError = null;
      app.startSession(created.vault, {
        masterKey: created.masterKey,
        entries: [],
        slotSetMismatch: null,
        slotIds: created.vault.slots.map((slot) => slot.id),
      });
      password.value = '';
      repeat.value = '';
      await app.requestPersist();
      const recoverySlot = created.vault.slots.find(
        (slot) => slot.kind === 'recovery',
      );
      const after = {
        code: created.code,
        next: 'list',
        first: true,
        unsavedCode: true,
        confirmedSlotId: recoverySlot ? recoverySlot.id : null,
      };
      // Карточка отпечатка — сразу после мастер-пароля; «Позже» в прошлый
      // раз или отсутствие платформенного аутентификатора — сразу код.
      // Список остаётся корнем истории: back с кода не выходит из данных.
      app.reset('list');
      if (
        app.settings.passkeyDismissed === true ||
        !(await canOfferPasskey())
      ) {
        app.navigate('recovery', after);
      } else {
        app.navigate('passkey', { after });
      }
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Создать хранилище';
      page.prepend(banner(app.describeError(error), { danger: true }));
    }
  });

  page.append(intro, form, about);
  root.replaceChildren(page);
  if (noStorage || app.vaultLoadError) {
    const alert = page.querySelector('.banner');
    if (alert) alert.focus();
    else focusHeading(page);
  } else {
    // На сенсорном экране автофокус открывает клавиатуру и рисует рамку
    // при каждом заходе; клавиатурный фокус остаётся видимым.
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!coarse) password.focus();
  }
}
