// Одно правило для кода восстановления (docs/ui.md §5.6, §5.9):
// пока код не подтверждён «Продолжить», он считается несохранённым —
// экран не блокируется, а слот в файле может быть ещё не записан.
// Отметка «код записан» живёт в теле файла (docs/format.md §3.1).

export function skipAutoLock(screen, props) {
  return screen === 'recovery' && props?.unsavedCode === true;
}

export function needsRecoveryConfirmation(vault, confirmed) {
  const slots = Array.isArray(vault?.slots) ? vault.slots : [];
  const known = Array.isArray(confirmed) ? confirmed : [];
  return slots.some(
    (slot) => slot.kind === 'recovery' && !known.includes(slot.id),
  );
}

// Подтверждение из тела сильнее настройки устройства. Настройка —
// след 0.2.1/0.2.2: на файле без поля она один раз переносится в сессию,
// попадёт в тело при ближайшем сохранении и потом удаляется.
export function recoveryConfirmedFrom(bodyConfirmed, slots, settings) {
  const list = Array.isArray(bodyConfirmed) ? [...bodyConfirmed] : [];
  if (list.length > 0) return { confirmed: list, fromSetting: false };
  const remembered = settings?.recoveryConfirmed;
  const fits =
    typeof remembered === 'string' &&
    (slots ?? []).some(
      (slot) => slot.id === remembered && slot.kind === 'recovery',
    );
  return fits
    ? { confirmed: [remembered], fromSetting: true }
    : { confirmed: [], fromSetting: false };
}

// Оставляет только id текущих слотов, без повторов, по возрастанию.
export function normalizeRecoveryConfirmed(list, slots) {
  const ids = new Set((slots ?? []).map((slot) => slot.id));
  const kept = [];
  for (const id of Array.isArray(list) ? list : []) {
    if (ids.has(id) && !kept.includes(id)) kept.push(id);
  }
  return kept.sort();
}

// Флаг снимается только после успешного «Продолжить»: если сохранение
// файла сорвалось, код остаётся несохранённым и экран по-прежнему не
// блокируется. Явный false от действия — это «Отмена» в диалоге записи:
// способ не записан, код не подтверждён.
export async function finishRecovery(props, action) {
  const result = await action();
  if (result === false) return false;
  if (props) props.unsavedCode = false;
  return true;
}

// Порог подсказки на экране несохранённого кода — решение владельца
// 27.11.2026. Проверка по Date.now, а не по числу тиков.
export const RECOVERY_REMINDER_MS = 10 * 60 * 1000;

export function recoveryReminder(elapsedMs) {
  return Number.isFinite(elapsedMs) && elapsedMs >= RECOVERY_REMINDER_MS;
}
