// Состояние глазка у поля пароля: подпись, тип поля и сброс.
// Без DOM и без таймеров — поэтому проверяется обычными тестами.

export const SHOWN_LABEL = 'Скрыть пароль';
export const HIDDEN_LABEL = 'Показать пароль';

export function passwordLabel(shown) {
  return shown ? SHOWN_LABEL : HIDDEN_LABEL;
}

export function passwordType(shown) {
  return shown ? 'text' : 'password';
}

export function passwordPressed(shown) {
  return shown ? 'true' : 'false';
}

// Событие 'toggle' — нажатие глазка; 'blur', 'submit', 'screen' — поводы
// снова скрыть значение. Возвращает следующее состояние.
export function nextPasswordShown(shown, event) {
  return event === 'toggle' ? !shown : false;
}
