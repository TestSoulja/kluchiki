// Имена файлов и тексты отказов импорта (docs/ui.md §5.7).
// Экспорт — не пересборка, а те же байты, что лежат в IndexedDB.

export function exportFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `kluchiki-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}.vault`;
}

export function importErrorMessage(error) {
  const message = String(error && error.message ? error.message : error);
  const newer = /версия (\d+) не поддерживается/.exec(message);
  if (newer) {
    return `файл новее этой версии приложения: version ${newer[1]}, поддерживается 1`;
  }
  return `файл не похож на хранилище Kluchiki: ${message}`;
}

// Дата копии по часам устройства, без UTC: человек видит свой день.
const STAMP = /^\d{4}-\d{2}-\d{2}$/;

export function todayStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

export function stampText(stamp) {
  if (typeof stamp !== 'string' || !STAMP.test(stamp)) return null;
  const [year, month, day] = stamp.split('-');
  return `${day}.${month}.${year}`;
}

// Напоминание об экспорте (plan.md §6): без копии, копия без изменений,
// изменения после копии. Даты — только ГГГГ-ММ-ДД в настройках.
export function exportReminder({ lastExportAt, changedAfterExport } = {}) {
  const copy = stampText(lastExportAt);
  if (copy === null) {
    return 'копии файла нет: сделайте её и проверьте, что файл открывается';
  }
  if (changedAfterExport === true) {
    return `изменения после копии от ${copy} — сделайте новую`;
  }
  return `копия файла — ${copy}`;
}

export function needsExportLink({ lastExportAt, changedAfterExport } = {}) {
  return stampText(lastExportAt) === null || changedAfterExport === true;
}

// Импорт не требует разблокировки: он заменяет файл целиком и остаётся
// единственным путём, когда пароль забыт или старый файл не разбирается.
// Экспорт — копия файла, но по решению владельца показывается только
// после разблокировки. Решение владельца 27.11.2026.
export function transferSections({ hasVault = false, unlocked = false } = {}) {
  return {
    export: unlocked === true,
    import: true,
    unlockLink: hasVault === true && unlocked !== true,
  };
}
