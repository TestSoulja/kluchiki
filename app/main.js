// Точка входа приложения. Держит состояние экрана, сессию, автоблокировку
// и хранилище в IndexedDB. Секреты живут только в памяти вкладки.

import { openDatabase, requestPersistence } from './store-idb.js';
import { readLockSettings, nextLockReason } from './lib/lock.js';
import {
  browserStorage,
  clearSession,
  restoreScreen,
  restoreSession,
  writeSession,
} from './lib/session-store.js';
import { openBodyWithMasterKey } from '../src/vault.js';
import { skipAutoLock, recoveryConfirmedFrom, normalizeRecoveryConfirmed } from './lib/recovery.js';
import { todayStamp } from './lib/backup.js';
import { createClipboardGuard, CLEAR_REFUSED } from './lib/clipboard.js';
import * as repo from './lib/repo.js';
import { renderCreate } from './ui/create.js';
import { renderUnlock } from './ui/unlock.js';
import { renderList } from './ui/list.js';
import { renderCard } from './ui/card.js';
import { renderGenerator } from './ui/generator.js';
import { renderSlots } from './ui/slots.js';
import { renderPasskey } from './ui/passkey.js';
import { renderRecovery } from './ui/recovery.js';
import { renderTransfer } from './ui/transfer.js';
import { renderCsv } from './ui/csv.js';
import { renderErase } from './ui/erase.js';
import { renderLoss } from './ui/loss.js';
import { el } from './ui/dom.js';
import { createNav } from './lib/nav.js';

const SCREENS = {
  create: renderCreate,
  unlock: renderUnlock,
  list: renderList,
  card: renderCard,
  generator: renderGenerator,
  slots: renderSlots,
  passkey: renderPasskey,
  recovery: renderRecovery,
  transfer: renderTransfer,
  csv: renderCsv,
  erase: renderErase,
  loss: renderLoss,
};

const TOAST_MS = 5000;
const SESSION_WRITE_MS = 5000;

const app = {
  root: document.getElementById('app'),
  screen: null,
  props: {},
  cleanup: null,

  store: null,
  storeError: null,
  vault: null,
  vaultText: undefined,
  vaultLoadError: null,
  settings: {},
  persistRefused: false,
  listQuery: '',
  exportToastShown: false,

  session: null,
  lockPolicy: readLockSettings(window.location),
  lastActivity: Date.now(),
  sessionWriteAt: 0,
  sessionWriteTimer: null,
  toastTimer: null,
  clipboard: null,

  show(name, props = {}) {
    const render = SCREENS[name];
    if (!render) throw new Error(`show: неизвестный экран ${name}`);
    if (typeof this.cleanup === 'function') {
      try {
        this.cleanup();
      } catch {
        // Уборка таймера не должна мешать смене экрана.
      }
    }
    this.cleanup = null;
    this.screen = name;
    this.props = props;
    render(this, props);
    // Смена экрана — редкое событие, в отличие от ввода: пишем сразу, чтобы
    // после перезагрузки открылся именно он. Частые события ввода ниже
    // ограничены пятью секундами.
    this.writeSessionNow();
  },

  // Пользовательские переходы: новый экран кладётся в стек, замена не
  // плодит записей истории. Рисует только show().
  navigate(name, props = {}) {
    nav.push(name, props);
    this.show(name, props);
  },

  replace(name, props = {}) {
    nav.replace(name, props);
    this.show(name, props);
  },

  reset(name, props = {}) {
    nav.reset(name, props);
    this.show(name, props);
  },

  back(patch) {
    return nav.back(patch);
  },

  // Кнопка «Назад» на корне: истории выше нет. Для дочерних экранов это
  // замена записи на их место, а список/вход/создание оставляют выход
  // системе — так back из списка выходит из приложения.
  backFallback() {
    if (this.screen === 'transfer') {
      if (!this.vault) return this.reset('create');
      if (!this.session) return this.reset('unlock');
      return this.reset('list');
    }
    if (
      ['card', 'slots', 'erase', 'generator', 'csv', 'loss'].includes(
        this.screen,
      )
    ) {
      if (this.session) return this.reset('list');
      return this.reset(this.vault ? 'unlock' : 'create');
    }
  },

  toast(text) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const node = el('div', { class: 'toast', text });
    host.replaceChildren(node);
    // Тост поверх содержимого и не меняет высоту страницы: на экране,
    // который помещается, прокрутка не появляется. Если он накрыл бы
    // только что нажатый элемент, показываем его сверху.
    const active = interactiveTarget(document.activeElement);
    avoidToastOverlap(host, node, active ?? lastActionTarget);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      host.replaceChildren();
      this.toastTimer = null;
    }, TOAST_MS);
  },

  startSession(vault, opened) {
    this.vault = vault;
    this.session = repo.makeSession(vault, opened.masterKey, opened);
    if (Array.isArray(opened.slotIds)) {
      this.session.slotIds = [...opened.slotIds];
    }
    this.session.slotSetMismatch =
      opened.slotSetMismatch ?? repo.compareSlotSets(vault, this.session.slotIds);
    // Файлы, записанные до 0.2.3, не помнят подтверждение кода: один раз
    // берём его из настройки устройства, чтобы подсказка не появилась
    // впервые. В тело значение попадёт при ближайшем сохранении.
    const migrated = recoveryConfirmedFrom(
      this.session.recoveryConfirmed,
      vault.slots,
      this.settings,
    );
    this.session.recoveryConfirmed = migrated.confirmed;
    this.session.recoveryConfirmedFromSetting = migrated.fromSetting;
    this.lastActivity = Date.now();
  },

  // Запись в память вкладки не чаще раза в 5 секунд: событий ввода много,
  // а после перезагрузки нужен только последний экран и время.
  scheduleSessionSave() {
    if (!this.session) return;
    const wait = Math.max(
      0,
      this.sessionWriteAt + SESSION_WRITE_MS - Date.now(),
    );
    if (wait === 0) {
      this.writeSessionNow();
      return;
    }
    if (this.sessionWriteTimer !== null) return;
    this.sessionWriteTimer = setTimeout(() => {
      this.sessionWriteTimer = null;
      this.writeSessionNow();
    }, wait);
  },

  writeSessionNow() {
    if (!this.session) return;
    const storage = browserStorage();
    if (!storage) return;
    const saved = writeSession(storage, {
      masterKey: this.session.masterKey,
      slotIds: this.session.slotIds,
      lastActivity: this.lastActivity,
      recoveryConfirmed: this.session.recoveryConfirmed,
      recoveryConfirmedFromSetting:
        this.session.recoveryConfirmedFromSetting === true,
      slotSetMismatch: this.session.slotSetMismatch,
      screen: this.screen,
    });
    if (saved) this.sessionWriteAt = Date.now();
  },

  wipeSession() {
    if (this.sessionWriteTimer !== null) {
      clearTimeout(this.sessionWriteTimer);
      this.sessionWriteTimer = null;
    }
    clearSession(browserStorage());
    if (this.session) repo.lockSession(this.session);
    this.session = null;
    // В истории не должно остаться экрана, который отрисуется после
    // wipeSession(): стек обнуляется, текущая запись становится корнем.
    nav.reset('unlock');
  },

  async saveEntries(entries, { acceptSlotSet = false, recoveryConfirmed, entrySaved = false } = {}) {
    if (!this.session) throw new Error('хранилище заблокировано');
    // Подтверждение кода пишется тем же сохранением, что и набор слотов:
    // иначе между двумя записями файл мог бы остаться без отметки.
    const confirmed = normalizeRecoveryConfirmed(
      recoveryConfirmed === undefined
        ? this.session.recoveryConfirmed
        : recoveryConfirmed,
      this.vault.slots,
    );
    const saved = await repo.saveEntries(
      this.vault,
      this.session.masterKey,
      entries,
      { acceptSlotSet, recoveryConfirmed: confirmed },
    );
    await this.store.writeVault(saved.text);
    this.vault = saved.vault;
    this.vaultText = saved.text;
    this.session.entries = entries;
    this.session.slotIds = saved.vault.slots.map((slot) => slot.id);
    this.session.slotSetMismatch = null;
    this.session.recoveryConfirmed = confirmed;
    // Любое успешное сохранение файла делает прежнюю копию неполной
    // (plan.md §6); дата копии снимается только скачиванием.
    await this.markChangedSinceExport();
    if (entrySaved && !this.exportToastShown && !this.settings.lastExportAt) {
      this.exportToastShown = true;
      this.toast(
        'копии файла нет: вернуть данные можно только из файла, который вы ' +
          'сохранили',
      );
    }
    if (this.session.recoveryConfirmedFromSetting) {
      // Настройка 0.2.x больше не нужна: файл теперь помнит подтверждение.
      this.session.recoveryConfirmedFromSetting = false;
      try {
        await this.writeSetting('recoveryConfirmed', undefined);
      } catch {
        // Файл сохранён; лишняя настройка ничего не ломает.
      }
    }
  },

  async markChangedSinceExport() {
    try {
      await this.writeSetting('changedAfterExport', true);
    } catch {
      // Файл сохранён; напоминание всё равно должно быть видно.
      this.settings.changedAfterExport = true;
    }
  },

  async markExported(date = new Date()) {
    const stamp = todayStamp(date);
    try {
      await this.writeSetting('lastExportAt', stamp);
      await this.writeSetting('changedAfterExport', false);
    } catch {
      this.settings.lastExportAt = stamp;
      this.settings.changedAfterExport = false;
    }
  },

  setVault(vault) {
    this.vault = vault;
    if (this.session) {
      this.session.slotSetMismatch = repo.compareSlotSets(
        vault,
        this.session.slotIds,
      );
    }
  },

  async writeSetting(key, value) {
    await this.store.writeSetting(key, value);
    if (value === undefined || value === null) delete this.settings[key];
    else this.settings[key] = value;
  },

  async requestPersist() {
    const result = await requestPersistence();
    this.persistRefused = result !== true;
    return result;
  },

  describeError(error) {
    const message = String(error && error.message ? error.message : error);
    if (/quota|место|storage|хранилищ/i.test(message)) {
      return 'браузер не дал место для записи: экспортируйте файл и освободите место';
    }
    return message;
  },

  describeSaveError(error) {
    const message = String(error && error.message ? error.message : error);
    if (/quota|место|storage/i.test(message)) {
      return 'не удалось сохранить: браузер не дал место. Экспортируйте файл и повторите';
    }
    return `не удалось сохранить: ${message}`;
  },

  async lock(reason) {
    if (!this.session) return;
    this.wipeSession();
    for (const dialog of document.querySelectorAll('dialog')) dialog.remove();
    this.replace('unlock', {
      lockedReason: reason === 'manual' ? null : reason,
    });
    // Если в буфере был скопированный пароль, пробуем стереть; отказ
    // браузера не скрываем (docs/ui.md §5.9).
    const hadCopied = this.clipboard.active;
    const cleared = await this.clipboard.clearNow({ quiet: true });
    if (hadCopied && !cleared) this.toast(CLEAR_REFUSED);
  },
};

const nav = createNav({
  history: window.history,
  onFallback: () => app.backFallback(),
});

// Системный жест, кнопки браузера и app.back() приходят сюда. Без сессии
// данные не рисуются ни при каком состоянии истории: только вход/создание.
window.addEventListener('popstate', (event) => {
  const entry = nav.pop(event.state);
  if (!app.session) {
    app.reset(app.vault ? 'unlock' : 'create');
    return;
  }
  if (!entry || !SCREENS[entry.screen]) {
    app.reset('list');
    return;
  }
  app.show(entry.screen, entry.props);
});

app.clipboard = createClipboardGuard({
  clipboard: {
    async writeText(text) {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('буфер недоступен');
      }
      await navigator.clipboard.writeText(text);
    },
  },
  toast: (text) => app.toast(text),
});

let lastActionTarget = null;

function interactiveTarget(node) {
  if (!(node instanceof Element)) return null;
  // Смотрим только на элементы, которые человек нажимает: body и обёртки
  // страницы занимают весь экран и всегда «перекрывались» бы тостом.
  return node.closest('button, a, label, input, textarea, select, summary');
}

function avoidToastOverlap(host, toastNode, target) {
  host.classList.remove('toasts-top');
  if (!target || !target.isConnected) return;
  const toastRect = toastNode.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (targetRect.width === 0 && targetRect.height === 0) return;
  const overlap = !(
    toastRect.right <= targetRect.left ||
    toastRect.left >= targetRect.right ||
    toastRect.bottom <= targetRect.top ||
    toastRect.top >= targetRect.bottom
  );
  if (overlap) host.classList.add('toasts-top');
}

function noteActivity() {
  if (!app.session) return;
  app.lastActivity = Date.now();
  app.scheduleSessionSave();
}

document.addEventListener('keydown', noteActivity, true);
document.addEventListener('pointerdown', noteActivity, true);
document.addEventListener('touchstart', noteActivity, true);

// Последний нажатый элемент — для проверки, не накрыл ли его тост.
document.addEventListener(
  'pointerdown',
  (event) => {
    const target = interactiveTarget(event.target);
    if (target) lastActionTarget = target;
  },
  true,
);
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = interactiveTarget(event.target);
    if (target) lastActionTarget = target;
  },
  true,
);

document.addEventListener('keydown', (event) => {
  if (app.screen !== 'list') return;
  if (event.key !== '/') return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  ) {
    return;
  }
  const search = document.getElementById('entry-search');
  if (search) {
    event.preventDefault();
    search.focus();
  }
});

function checkLock() {
  if (!app.session) return;
  // Пока код восстановления не подтверждён «Продолжить», он считается
  // несохранённым: блокировка на этом экране потеряла бы его безвозвратно.
  if (skipAutoLock(app.screen, app.props)) return;
  const reason = nextLockReason(
    { now: Date.now(), lastActivity: app.lastActivity },
    app.lockPolicy,
  );
  if (reason) void app.lock(reason);
}

// Скрытая вкладка не тикает: срок проверяется сразу при возвращении.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkLock();
});

setInterval(checkLock, 1000);

async function boot() {
  try {
    app.store = await openDatabase();
    app.settings = await app.store.readSettings();
    app.vaultText = await app.store.readVault();
  } catch (error) {
    app.storeError = String(error && error.message ? error.message : error);
    app.reset('create');
    return;
  }

  if (!app.vaultText) {
    clearSession(browserStorage());
    app.reset('create');
    return;
  }

  try {
    app.vault = repo.parseVault(app.vaultText);
  } catch (error) {
    clearSession(browserStorage());
    app.vaultLoadError = String(error && error.message ? error.message : error);
    app.reset('create');
    return;
  }

  // Перезагрузка страницы не разлогинивает: пока запись в памяти вкладки
  // свежая, MK берётся оттуда, тело расшифровывается, записи — из базы.
  const restored = await restoreSession({
    storage: browserStorage(),
    vault: app.vault,
    now: Date.now(),
    idleMs: app.lockPolicy.idleMs,
    decryptBody: (vault, masterKey) => openBodyWithMasterKey(vault, masterKey),
  });
  if (restored.kind === 'ok') {
    const { entry, body } = restored;
    app.session = repo.makeSession(app.vault, entry.masterKey, {
      entries: body.entries,
      slotIds: body.slots,
      recoveryConfirmed: body.recoveryConfirmed ?? [],
      slotSetMismatch:
        repo.compareSlotSets(app.vault, body.slots) ?? entry.slotSetMismatch,
    });
    app.session.recoveryConfirmedFromSetting =
      entry.recoveryConfirmedFromSetting === true;
    app.lastActivity = entry.lastActivity;
    app.reset(restoreScreen(entry.screen));
    return;
  }
  if (restored.kind === 'expired') {
    app.reset('unlock', {
      message: 'сессия истекла: введите пароль заново',
    });
    return;
  }
  if (restored.kind === 'stale') {
    app.reset('unlock', {
      message: 'файл хранилища изменился: введите пароль заново',
    });
    return;
  }

  app.reset('unlock');
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    // Отказ регистрации не ломает приложение: оно работает без офлайна.
    console.warn(
      `service worker не зарегистрирован: ${error && error.message ? error.message : error}`,
    );
  }
}

void registerServiceWorker();
void boot();
