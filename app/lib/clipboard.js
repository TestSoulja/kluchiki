// Копирование со страховкой (docs/ui.md §5.3, §5.9):
// через 30 с приложение пытается записать в буфер пустую строку.
// Удалось — тост «Буфер очищен»; нет — честный отказ, без вида, что очистило.
//
// Время — по Date.now: таймер может сработать позже срока, поэтому
// проверка повторяется с остатком, пока срок не кончится.

export const CLEAR_DELAY_MS = 30 * 1000;

export const COPY_UNAVAILABLE =
  'не удалось скопировать: браузер не дал доступ к буферу. ' +
  'Выделите значение и нажмите Ctrl+C';

export const CLEAR_REFUSED =
  'браузер не дал очистить буфер: очистите вручную (Win+V → удалить)';

export function createClipboardGuard({
  clipboard,
  toast,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  delay = CLEAR_DELAY_MS,
}) {
  let timer = null;
  let deadline = 0;
  let active = false;

  function arm(ms) {
    timer = schedule(tick, ms);
  }

  async function tick() {
    timer = null;
    const left = deadline - now();
    if (left > 0) {
      arm(left);
      return;
    }
    await clearNow();
  }

  async function clearNow({ quiet = false } = {}) {
    if (!active) return false;
    active = false;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    try {
      await clipboard.writeText('');
      if (!quiet) toast('Буфер очищен');
      return true;
    } catch {
      toast(CLEAR_REFUSED);
      return false;
    }
  }

  async function copy(value, label = 'Пароль', unavailable = COPY_UNAVAILABLE) {
    try {
      await clipboard.writeText(value);
    } catch {
      toast(unavailable);
      return false;
    }
    active = true;
    deadline = now() + delay;
    if (timer !== null) cancel(timer);
    arm(delay);
    // Метки приходят строчными для aria-label («Копировать логин»),
    // а тост начинается с заглавной: «Пароль скопирован». «Заметки» —
    // множественное число, поэтому глагол другой.
    const shown = label.charAt(0).toLocaleUpperCase('ru-RU') + label.slice(1);
    const verb = label === 'заметки' ? 'скопированы' : 'скопирован';
    toast(`${shown} ${verb}. Через 30 с приложение попробует очистить буфер.`);
    return true;
  }

  function dispose() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    active = false;
  }

  return {
    copy,
    clearNow,
    dispose,
    get active() {
      return active;
    },
  };
}
