// Стек экранов и History API (docs/ui.md §5.10).
//
// В history.state лежит только номер записи. Сами экраны и их props — в
// памяти вкладки: черновики, пароли и entryId в состояние браузера не
// попадают и после перезагрузки не восстанавливаются.

export const NAV_MARK = 1;
export const MAX_DEPTH = 20;

function isNavState(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.kluchiki === NAV_MARK &&
    Number.isInteger(value.index) &&
    value.index >= 0
  );
}

function asProps(props) {
  return props !== null && typeof props === 'object' ? props : {};
}

// onFallback зовётся, когда back() нажимают на корневом экране: истории
// выше нет, и решение остаётся за приложением.
export function createNav({ history, onFallback = null } = {}) {
  if (!history) throw new Error('nav: нужен history');

  const stack = [];
  let current = -1;
  let pendingPatch = null;

  function stateFor(index) {
    return { kluchiki: NAV_MARK, index };
  }

  function push(screen, props = {}) {
    pendingPatch = null;
    const entry = { screen, props: asProps(props) };
    if (current < 0) {
      stack.push(entry);
      current = 0;
      history.replaceState(stateFor(0), '');
      return entry;
    }
    if (current >= MAX_DEPTH) {
      // Дальше 20 экранов стек не растёт: новый экран заменяет текущий.
      stack.length = current + 1;
      stack[current] = entry;
      history.replaceState(stateFor(current), '');
      return entry;
    }
    stack.length = current + 1;
    stack.push(entry);
    current = stack.length - 1;
    history.pushState(stateFor(current), '');
    return entry;
  }

  function replace(screen, props = {}) {
    pendingPatch = null;
    const entry = { screen, props: asProps(props) };
    if (current < 0) {
      stack.length = 0;
      stack.push(entry);
      current = 0;
      history.replaceState(stateFor(0), '');
      return entry;
    }
    stack.length = current + 1;
    stack[current] = entry;
    history.replaceState(stateFor(current), '');
    return entry;
  }

  // patchParent меняет props экрана, на который возвращаемся. Патч лежит
  // в памяти и применяется в popstate, до отрисовки.
  function back(patchParent) {
    pendingPatch =
      patchParent !== null && typeof patchParent === 'object'
        ? patchParent
        : null;
    if (current > 0) {
      history.back();
      return true;
    }
    pendingPatch = null;
    if (typeof onFallback === 'function') onFallback();
    return false;
  }

  function reset(screen, props = {}) {
    pendingPatch = null;
    stack.length = 0;
    stack.push({ screen, props: asProps(props) });
    current = 0;
    history.replaceState(stateFor(0), '');
    return stack[0];
  }

  // Возвращает экран для отрисовки или null, если запись истории чужая
  // или её больше нет в стеке. null означает «данные не рисовать».
  function pop(state) {
    if (!isNavState(state) || state.index >= stack.length) {
      pendingPatch = null;
      return null;
    }
    current = state.index;
    const entry = stack[current];
    if (pendingPatch) {
      entry.props = { ...entry.props, ...pendingPatch };
      pendingPatch = null;
    }
    return { screen: entry.screen, props: entry.props };
  }

  function depth() {
    return current < 0 ? 0 : current;
  }

  function top() {
    return current < 0 ? null : { ...stack[current] };
  }

  return { push, replace, back, reset, pop, depth, top };
}
