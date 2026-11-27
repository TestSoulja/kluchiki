// Слово подтверждения «СТЕРЕТЬ»: кириллица, любой регистр, латиница
// не принимается (docs/ui.md §5.8, §9 п. 4).

export const ERASE_WORD = 'СТЕРЕТЬ';

export function isEraseConfirmed(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
  return normalized === ERASE_WORD.toLocaleLowerCase('ru-RU');
}
