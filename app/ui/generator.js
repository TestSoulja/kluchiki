// 4 — генератор паролей (docs/ui.md §5.4).

import {
  el,
  heading,
  button,
  iconButton,
  checkbox,
  banner,
  hint,
  focusHeading,
} from './dom.js';
import { backIcon } from './icons.js';
import {
  CHARACTER_SETS,
  DEFAULT_LENGTH,
  MIN_LENGTH,
  MAX_LENGTH,
  buildAlphabet,
  clampLength,
  describeResult,
  entropyBits,
  generatePassword,
  isShort,
} from '../lib/generator.js';

function hasCrypto() {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  );
}

export function renderGenerator(app, props = {}) {
  const page = el('div', { class: 'page page-narrow' });
  const hasDraft = props.draft && typeof props.draft === 'object';

  function goBack() {
    if (hasDraft) {
      // Возврат в правку с тем черновиком, который был на момент ухода:
      // props предыдущего экрана живут в памяти, в history.state их нет.
      app.back({ draft: props.draft });
    } else {
      app.back();
    }
  }

  const back = iconButton('Назад', '', goBack);
  back.replaceChildren(backIcon());
  page.append(
    el(
      'div',
      { class: 'screen-header' },
      back,
      heading('Генератор'),
      el('span', { class: 'header-spacer' }),
    ),
  );

  const cryptoOk = hasCrypto();
  if (!cryptoOk) {
    page.append(
      banner('браузер не дал генератор случайных чисел (crypto)', {
        danger: true,
      }),
    );
  }

  const options = {
    length: DEFAULT_LENGTH,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    excludeSimilar: false,
  };
  let password = '';

  const result = el('div', {
    class: 'gen-result',
    tabindex: '0',
    'aria-label': 'сгенерированный пароль',
  });
  const meta = el('p', { class: 'counter' });
  const live = el('p', { class: 'sr-only', 'aria-live': 'polite' });

  const warning = el('div', { class: 'banner-slot' });

  const lengthId = 'gen-length';
  const lengthInput = el('input', {
    id: lengthId,
    class: 'input length-input',
    type: 'number',
    min: String(MIN_LENGTH),
    max: String(MAX_LENGTH),
    step: '1',
    value: String(options.length),
    inputmode: 'numeric',
    'aria-label': 'Длина',
  });
  const minus = iconButton('Уменьшить длину', '', () => stepLength(-1));
  minus.textContent = '−';
  const plus = iconButton('Увеличить длину', '', () => stepLength(1));
  plus.textContent = '+';

  function stepLength(delta) {
    options.length = clampLength(options.length + delta);
    lengthInput.value = String(options.length);
    refresh();
  }

  const setInputs = {};
  const setRows = [];
  for (const set of CHARACTER_SETS) {
    const box = checkbox(`gen-${set.key}`, `${set.label} (${set.chars.length})`, options[set.key]);
    box.input.addEventListener('change', () => {
      options[set.key] = box.input.checked;
      refresh();
    });
    setInputs[set.key] = box.input;
    setRows.push(box.label);
  }

  const similar = checkbox(
    'gen-similar',
    'исключить похожие i l 1 I O 0 o',
    options.excludeSimilar,
  );
  similar.input.addEventListener('change', () => {
    options.excludeSimilar = similar.input.checked;
    refresh();
  });

  const needOne = hint('нужен хотя бы один набор');

  function refresh() {
    const alphabet = buildAlphabet(options);
    const selected = CHARACTER_SETS.filter((set) => options[set.key]);
    for (const set of CHARACTER_SETS) {
      const box = setInputs[set.key];
      box.disabled = selected.length === 1 && options[set.key];
    }
    needOne.hidden = selected.length !== 1;
    if (cryptoOk) {
      try {
        password = generatePassword(options);
        result.textContent = password;
        live.textContent = `новый пароль, ${options.length} символов`;
      } catch {
        password = '';
        result.textContent = '—';
      }
    } else {
      result.textContent = '—';
    }
    meta.textContent = describeResult(options.length, alphabet.length);
    warning.replaceChildren();
    if (isShort(options.length) && alphabet.length > 0) {
      warning.append(
        banner(
          `короче 12 символов — короче рекомендованного; энтропия ${entropyBits(
            clampLength(options.length),
            alphabet.length,
          )} бит`,
        ),
      );
    }
  }

  lengthInput.addEventListener('input', () => {
    options.length = clampLength(lengthInput.value);
    refresh();
  });
  lengthInput.addEventListener('blur', () => {
    lengthInput.value = String(options.length);
  });

  const generate = button('Сгенерировать', {
    onclick: () => {
      refresh();
    },
  });
  const copy = button('Копировать', {
    kind: 'secondary',
    onclick: async () => {
      if (password !== '') await app.clipboard.copy(password, 'Пароль');
    },
  });
  const actions = el('div', { class: 'actions' }, generate, copy);
  if (hasDraft) {
    actions.append(
      button('Использовать', {
        kind: 'secondary',
        onclick: () => {
          if (password === '') return;
          app.back({ draft: { ...props.draft, password } });
        },
      }),
    );
  }
  if (!cryptoOk) {
    generate.disabled = true;
    copy.disabled = true;
  }

  page.append(
    el('div', { class: 'gen-block' }, result, meta),
    warning,
    el(
      'div',
      { class: 'settings' },
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'label', id: 'gen-length-label', text: 'Длина' }),
        el(
          'div',
          { class: 'length-row', role: 'group', 'aria-labelledby': 'gen-length-label' },
          minus,
          lengthInput,
          plus,
        ),
      ),
      el('div', { class: 'checkbox-stack' }, ...setRows, needOne, similar.label),
      hint(
        'энтропия = длина × log2(размер набора), округление вниз; расчёт ' +
          'предполагает равномерный выбор',
      ),
    ),
    actions,
    live,
  );

  app.cleanup = null;
  app.root.replaceChildren(page);
  refresh();
  focusHeading(page);
}
