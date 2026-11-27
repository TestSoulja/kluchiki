// 7 — экспорт и импорт (docs/ui.md §5.7).

import {
  el,
  heading,
  button,
  textButton,
  iconButton,
  checkbox,
  hint,
  downloadBlob,
  focusHeading,
} from './dom.js';
import { backIcon } from './icons.js';
import { parseVault } from '../lib/repo.js';
import {
  exportFilename,
  importErrorMessage,
  transferSections,
} from '../lib/backup.js';
import { csvExportSection } from './csv.js';

export function renderTransfer(app) {
  const page = el('div', { class: 'page page-narrow' });
  const hasVault = Boolean(app.vault);
  const unlocked = Boolean(app.session);
  const sections = transferSections({ hasVault, unlocked });

  function goBack() {
    app.back();
  }

  const back = iconButton('Назад', '', goBack);
  back.replaceChildren(backIcon());
  page.append(
    el(
      'div',
      { class: 'screen-header' },
      back,
      heading('Экспорт и импорт'),
      el('span', { class: 'header-spacer' }),
    ),
  );

  if (sections.unlockLink) {
    page.append(
      el(
        'div',
        { class: 'actions' },
        textButton('Разблокировать', () => app.back()),
      ),
    );
  }

  if (sections.export) {
    const exportBlock = el(
      'section',
      { class: 'section' },
      el('h2', { class: 'h2', text: 'Экспорт' }),
      el('p', {
        class: 'text',
        text:
          'Файл хранилища уже зашифрован. Экспорт — это копия файла; ' +
          'хранить её можно где угодно, но без мастер-пароля она не открывается',
      }),
    );
    const download = button('Скачать файл', {
      onclick: async () => {
        const name = exportFilename();
        downloadBlob(
          new Blob([app.vaultText], { type: 'application/json' }),
          name,
        );
        await app.markExported();
        app.toast(`Файл скачан: ${name}`);
      },
    });
    exportBlock.append(el('div', { class: 'actions' }, download));
    page.append(exportBlock);
  }

  if (hasVault) page.append(csvExportSection(app));

  const importBlock = el(
    'section',
    { class: 'section' },
    el('h2', { class: 'h2', text: 'Импорт' }),
    el('p', {
      class: 'text',
      text:
        'Импорт заменит хранилище на этом устройстве: текущие записи и ' +
        'способы входа будут потеряны, вернуть их можно только из файла, ' +
        'который вы сохранили раньше',
    }),
  );

  const fileId = 'import-file';
  const fileInput = el('input', {
    id: fileId,
    type: 'file',
    class: 'sr-only file-input',
    accept: '.vault,application/json',
  });
  const pick = el('label', {
    class: 'btn btn-secondary',
    for: fileId,
    text: 'Выбрать файл',
  });
  // Поле файла скрыто от глаз, но фокусируется с клавиатуры; кольцо
  // фокуса показывает видимая кнопка-метка (docs/ui.md §6.1).
  const pickBox = el('div', { class: 'file-pick' }, pick, fileInput);
  const chosen = el('p', { class: 'hint', text: 'файл не выбран' });
  const error = el('p', { class: 'error', role: 'status', hidden: true });
  const { input: agree, label: agreeLabel } = checkbox(
    'import-agree',
    'понимаю, что текущее хранилище будет заменено',
  );
  const submit = button('Импортировать', {
    kind: 'danger-outline',
    type: 'submit',
  });
  submit.disabled = true;

  let file = null;

  function update() {
    submit.disabled = !(file && agree.checked);
  }

  fileInput.addEventListener('change', () => {
    file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    chosen.textContent = file ? `выбран файл: ${file.name}` : 'файл не выбран';
    error.hidden = true;
    update();
  });
  agree.addEventListener('change', update);

  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el('div', { class: 'field' }, pickBox, chosen),
    agreeLabel,
    el('div', { class: 'actions' }, submit),
    error,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!file) return;
    submit.disabled = true;
    submit.textContent = 'Читаем…';
    let text;
    try {
      text = await file.text();
    } catch {
      error.hidden = false;
      error.textContent = 'не удалось прочитать файл';
      submit.disabled = false;
      submit.textContent = 'Импортировать';
      return;
    }
    let vault;
    try {
      vault = parseVault(text);
    } catch (failure) {
      error.hidden = false;
      error.textContent = importErrorMessage(failure);
      submit.disabled = false;
      submit.textContent = 'Импортировать';
      return;
    }
    try {
      await app.store.writeVault(text);
    } catch (failure) {
      error.hidden = false;
      error.textContent = `не удалось записать файл: ${app.describeError(failure)}`;
      submit.disabled = false;
      submit.textContent = 'Импортировать';
      return;
    }
    app.wipeSession();
    app.vaultText = text;
    app.vault = vault;
    app.vaultLoadError = null;
    app.listQuery = '';
    // Импорт заменяет файл: копия, если она была, больше не про этот файл.
    await app.markChangedSinceExport();
    app.reset('unlock', {
      message:
        'Файл загружен. Разблокируйте его способом, который в нём записан',
    });
  });

  importBlock.append(form);
  importBlock.append(
    hint(
      'файл проверяется до записи: чужой файл или файл новее этой версии ' +
        'не заменит хранилище',
    ),
  );
  page.append(importBlock);

  if (hasVault) {
    const csvImport = el(
      'section',
      { class: 'section' },
      el('h2', { class: 'h2', text: 'Импорт CSV' }),
      el('p', {
        class: 'text',
        text:
          'CSV — открытый текст; после импорта удалите файл, приложение его ' +
          'не удаляет. Записи добавляются к текущим, хранилище не заменяется.',
      }),
    );
    if (unlocked) {
      csvImport.append(
        el(
          'div',
          { class: 'actions' },
          button('Импорт CSV', { onclick: () => app.navigate('csv') }),
        ),
      );
    } else {
      const disabled = button('Импорт CSV', { kind: 'secondary' });
      disabled.disabled = true;
      csvImport.append(
        el('p', {
          class: 'hint',
          text:
            'сначала разблокируйте: записи вписываются в зашифрованное ' +
            'хранилище',
        }),
        el('div', { class: 'actions' }, disabled),
      );
    }
    page.append(csvImport);
  }

  app.cleanup = null;
  app.root.replaceChildren(page);
  focusHeading(page);
}
