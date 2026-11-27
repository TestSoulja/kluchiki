// Выбор способа входа по умолчанию (docs/ui.md §5.1, 1б): рабочий
// отпечаток — первый и открытый; иначе пароль. Автовызов get() не делается:
// системный диалог биометрии не должен появляться без нажатия.

import { prfAddressError } from './passkey.js';

function usable(slot, hostname, isLost) {
  if (!slot || slot.version !== 1) return false;
  if (isLost(slot)) return false;
  if (slot.kind === 'prf') return prfAddressError(slot, hostname) === null;
  return slot.kind === 'password';
}

export function pickDefaultSlot(slots, { hostname, isLost = () => false } = {}) {
  const prf = slots.find(
    (slot) => slot.kind === 'prf' && usable(slot, hostname, isLost),
  );
  if (prf) return prf.id;
  const password = slots.find(
    (slot) => slot.kind === 'password' && usable(slot, hostname, isLost),
  );
  return password ? password.id : null;
}

// Рабочий отпечаток поднимается наверх, остальные слоты сохраняют порядок.
export function orderSlots(slots, { hostname, isLost = () => false } = {}) {
  const prf = slots.find(
    (slot) => slot.kind === 'prf' && usable(slot, hostname, isLost),
  );
  if (!prf) return slots;
  return [prf, ...slots.filter((slot) => slot !== prf)];
}
