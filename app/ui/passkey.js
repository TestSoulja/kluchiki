// Карточка после создания мастер-пароля: предложить вход по отпечатку.
// «Позже» пишется в настройки устройства: второй раз на это хранилище
// карточка не появляется (при «Стереть всё» настройки исчезают вместе с ним).

import {
  el,
  heading,
  button,
  banner,
  hint,
  focusHeading,
} from './dom.js';
import {
  canOfferPasskey,
  isUserCancelled,
  passkeyApiAvailable,
  passkeyOfferState,
  setupPrfSlot,
  PASSKEY_MESSAGES,
} from '../lib/passkey.js';

const SYNC_NOTE =
  'Отпечаток привязан к устройству и аккаунту: если passkey ' +
  'синхронизируется, вход возможен и на других ваших устройствах.';

const OFFERED_SETTING = 'passkeyDismissed';

async function markDismissed(app) {
  app.settings[OFFERED_SETTING] = true;
  try {
    await app.writeSetting(OFFERED_SETTING, true);
  } catch {
    // Настройка не записалась — карточку в этой вкладке всё равно не
    // повторяем; после перезагрузки она может появиться снова.
  }
}

export function renderPasskey(app, props = {}) {
  const after = props.after ?? { next: 'list' };
  if (!app.session) {
    app.reset('unlock');
    return;
  }
  // «Позже» уже нажато (или проверка не прошла): второй раз не спрашиваем.
  if (app.settings[OFFERED_SETTING] === true) {
    app.replace('recovery', after);
    return;
  }
  if (!passkeyApiAvailable()) {
    void markDismissed(app);
    app.replace('recovery', after);
    return;
  }

  const page = el('div', { class: 'page page-narrow' });
  const title = heading('Вход по отпечатку?');
  const status = el('div', { class: 'banner-slot' });
  const card = el('section', { class: 'card' });
  const text = el('p', { class: 'text', text: SYNC_NOTE });
  const note = hint(
    'Пароль и код восстановления остаются: отпечаток — ещё один способ, ' +
      'а не замена им',
  );
  const configure = button('Настроить');
  const later = button('Позже', { kind: 'secondary' });
  const actions = el('div', { class: 'actions' }, configure, later);
  card.append(text, note, actions);
  page.append(title, status, card);

  function goLater() {
    void markDismissed(app);
    app.replace('recovery', after);
  }

  function showUnsupported(message) {
    card.remove();
    status.replaceChildren(banner(message));
    const next = button('Продолжить');
    next.addEventListener('click', goLater);
    page.append(el('div', { class: 'actions' }, next));
    next.focus();
  }

  later.addEventListener('click', goLater);

  configure.addEventListener('click', async () => {
    configure.disabled = true;
    later.disabled = true;
    configure.textContent = 'Ждём подтверждения…';
    status.replaceChildren();
    const before = app.vault;
    try {
      const result = await setupPrfSlot({
        vault: app.vault,
        masterKey: app.session.masterKey,
        credentials: navigator.credentials,
        rpId: window.location.hostname,
        userName: 'kluchiki',
      });
      app.setVault(result.vault);
      try {
        await app.saveEntries(app.session.entries, { acceptSlotSet: true });
      } catch (error) {
        // Файл не записан — слот в памяти не оставляем.
        app.setVault(before);
        throw error;
      }
      void markDismissed(app);
      app.toast('отпечаток добавлен');
      app.replace('recovery', after);
    } catch (error) {
      if (isUserCancelled(error)) {
        configure.disabled = false;
        later.disabled = false;
        configure.textContent = 'Настроить';
        return;
      }
      const state = passkeyOfferState(error);
      if (state === 'unsupported') {
        void markDismissed(app);
        showUnsupported(
          error.code === 'unstable' ? error.message : PASSKEY_MESSAGES.unsupported,
        );
        return;
      }
      configure.disabled = false;
      later.disabled = false;
      configure.textContent = 'Настроить';
      status.replaceChildren(
        banner(
          `не удалось добавить отпечаток: ${app.describeError(error)}`,
          { danger: true },
        ),
      );
    }
  });

  app.cleanup = null;
  app.root.replaceChildren(page);
  focusHeading(page);
  // Проверка платформенного аутентификатора асинхронная; если её нет,
  // карточка не остаётся на экране.
  void canOfferPasskey().then((offer) => {
    if (!offer && app.screen === 'passkey') {
      void markDismissed(app);
      app.replace('recovery', after);
    }
  });
}
