// Мелкие помощники DOM. Только createElement/textContent: ни innerHTML,
// ни вставки HTML из данных человека.

import { eyeIcon, eyeOffIcon } from './icons.js';
import {
  HIDDEN_LABEL,
  nextPasswordShown,
  passwordLabel,
  passwordPressed,
  passwordType,
} from '../lib/password-field.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else if (key === 'disabled') node.disabled = Boolean(value);
      else if (key === 'hidden') node.hidden = Boolean(value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function heading(text, attrs = {}) {
  return el('h1', { tabindex: '-1', text, ...attrs });
}

export function focusHeading(node) {
  const first = node.querySelector('h1');
  if (first) first.focus();
}

export function button(label, { kind = 'primary', type = 'button', ...rest } = {}) {
  return el('button', { type, class: `btn btn-${kind}`, ...rest }, label);
}

export function textButton(label, onClick) {
  return el('button', { type: 'button', class: 'btn btn-text', onclick: onClick }, label);
}

export function iconButton(label, glyph, onClick) {
  return el(
    'button',
    {
      type: 'button',
      class: 'icon-btn',
      'aria-label': label,
      title: label,
      onclick: onClick,
    },
    glyph,
  );
}

export function errorText(text) {
  return el('p', { class: 'error', role: 'status', text });
}

export function hint(text, id) {
  return el('p', { class: 'hint', id, text });
}

export function labelFor(id, text) {
  return el('label', { class: 'label', for: id, text });
}

export function field(id, text, attrs = {}) {
  return el('input', {
    id,
    class: 'input',
    'aria-describedby': attrs.describedby,
    ...attrs,
  });
}

// Поле пароля с глазком. Атрибуты — как у field(): autocomplete, value,
// describedby. Значение не копируется в атрибуты и не логируется.
export function passwordField(id, attrs = {}) {
  const input = field(id, '', { ...attrs, type: 'password' });
  const toggle = el('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-pressed': 'false',
    'aria-label': HIDDEN_LABEL,
    title: HIDDEN_LABEL,
  });

  const isShown = () => input.type === 'text';
  const apply = (next) => {
    input.type = passwordType(next);
    const label = passwordLabel(next);
    toggle.setAttribute('aria-pressed', passwordPressed(next));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.replaceChildren(next ? eyeOffIcon() : eyeIcon());
  };
  const hide = () => apply(nextPasswordShown(isShown(), 'blur'));

  apply(false);

  toggle.addEventListener('click', () => {
    apply(nextPasswordShown(isShown(), 'toggle'));
  });
  // Уход из поля в сам глазок не скрывает: нажатие на глазок само решает,
  // показать значение или спрятать. Любой другой уход — скрывает.
  input.addEventListener('blur', (event) => {
    if (event.relatedTarget === toggle) return;
    hide();
  });
  toggle.addEventListener('blur', hide);
  // Отправка формы прячет значение, даже если экран останется прежним.
  // Форма известна только после вставки поля в документ.
  let formBound = false;
  const bindForm = () => {
    if (formBound || !input.form) return;
    formBound = true;
    input.form.addEventListener('submit', hide);
  };
  input.addEventListener('focus', bindForm);
  input.addEventListener('input', bindForm);

  const node = el('div', { class: 'inline-field with-eye' }, input, toggle);
  return { input, node };
}

export function checkbox(id, text, checked = false, attrs = {}) {
  const input = el('input', {
    type: 'checkbox',
    id,
    class: 'checkbox-input',
    checked,
    ...attrs,
  });
  const box = el('span', {
    class: 'checkbox-box',
    'aria-hidden': 'true',
    text: '✓',
  });
  const label = el(
    'label',
    { class: 'checkbox', for: id },
    input,
    box,
    el('span', { class: 'checkbox-text', text }),
  );
  return { input, label };
}

export function banner(text, { danger = false, action = null } = {}) {
  return el(
    'div',
    {
      class: `banner${danger ? ' banner-danger' : ''}`,
      // Настойчивый (assertive) live-регион — только ошибка разблокировки
      // (ui.md §6.1); баннеры объявляются вежливо.
      role: 'status',
      tabindex: '-1',
    },
    el('p', { class: 'banner-text', text }),
    action,
  );
}

export function dialogConfirm({
  title,
  text,
  confirmLabel = 'Записать',
  cancelLabel = 'Отмена',
  danger = false,
}) {
  return new Promise((resolve) => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cancel = el('button', {
      type: 'button',
      class: 'btn btn-secondary',
      text: cancelLabel,
    });
    const okay = el('button', {
      type: 'button',
      class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
      text: confirmLabel,
    });
    const dialog = el(
      'dialog',
      { class: 'dialog' },
      el('h2', { class: 'dialog-title', text: title }),
      el('p', { class: 'dialog-text', text }),
      el('div', { class: 'dialog-actions' }, cancel, okay),
    );
    cancel.addEventListener('click', () => dialog.close('cancel'));
    okay.addEventListener('click', () => dialog.close('ok'));
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'ok';
      dialog.remove();
      if (returnFocus && returnFocus.isConnected) returnFocus.focus();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  // Ссылку и URL убираем после того, как браузер успел начать загрузку.
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

export function menu(label, items) {
  const list = el('div', { class: 'menu-list', role: 'menu' });
  const details = el('details', { class: 'menu' });
  const summary = el(
    'summary',
    { class: 'icon-btn', 'aria-label': label, title: label },
    '⋯',
  );
  for (const item of items) {
    const control = el(
      'button',
      { type: 'button', class: 'menu-item', role: 'menuitem' },
      item.label,
    );
    control.addEventListener('click', () => {
      details.open = false;
      item.run();
    });
    list.append(control);
  }
  details.append(summary, list);
  return details;
}

export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso ?? '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function pluralCode(code) {
  return String(code).split('-');
}

export function setBusy(buttons, busy) {
  for (const node of buttons) {
    if (!node) continue;
    node.disabled = busy || node.dataset.wasDisabled === 'true';
  }
}
