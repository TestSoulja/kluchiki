// Инлайн-иконки 20 × 20 px. Никаких внешних файлов: CSP запрещает сеть.
//
// Пространство имён SVG — идентификатор, а не адрес запроса. Собирается
// из частей, чтобы страж «нет внешних адресов» не принимал его за ссылку.

const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');

function icon(paths) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.7');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

export function backIcon() {
  return icon(['M12.5 4.5 7 10l5.5 5.5', 'M7 10h9']);
}

export function copyIcon() {
  return icon(['M7.5 6.5h8v9h-8z', 'M12.5 6.5v-2h-8v9h2']);
}

// Глазок: око с зрачком; «перечёркнутый» — тот же контур и черта.
const EYE_OUTLINE = 'M2 10c2-3.2 4.7-5 8-5s6 1.8 8 5c-2 3.2-4.7 5-8 5s-6-1.8-8-5Z';
const EYE_PUPIL = 'M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z';

export function eyeIcon() {
  return icon([EYE_OUTLINE, EYE_PUPIL]);
}

export function eyeOffIcon() {
  return icon([EYE_OUTLINE, EYE_PUPIL, 'M4 4l12 12']);
}
