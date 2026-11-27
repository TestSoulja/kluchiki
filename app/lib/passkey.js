// WebAuthn PRF: создание passkey и получение секрета для слота kind = "prf".
//
// Здесь нет DOM и нет IndexedDB: функции принимают navigator.credentials
// и rpId, поэтому проверяются в node --test с подставным аутентификатором.
// Формат хранилища не меняется: слот prf существовал с версии 1
// (docs/format.md §4.4), этот модуль только получает его секрет.

import {
  addSlot,
  prfSalt,
} from '../../src/slots.js';
import {
  assertBytes,
  fromBase64url,
  randomBytes,
  toBase64url,
} from '../../src/bytes.js';

export const PASSKEY_MESSAGES = Object.freeze({
  unsupported: 'устройство не поддерживает вход по отпечатку',
  unstable:
    'устройство вернуло разные секреты: вход по отпечатку как ключ не годится',
  wrong: 'отпечаток не подошёл',
  otherAddress: 'этот отпечаток создан для другого адреса',
});

export class PasskeyError extends Error {
  constructor(code, message = PASSKEY_MESSAGES[code]) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

// Пользователь закрыл системное окно или отменил проверку. Это не ошибка
// настройки: интерфейс ничего не пишет и не показывает красный текст.
export function isUserCancelled(error) {
  const name = error && error.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

export function passkeyApiAvailable(env = globalThis) {
  const credentials = env && env.navigator ? env.navigator.credentials : null;
  return Boolean(
    credentials &&
      typeof credentials.create === 'function' &&
      typeof credentials.get === 'function',
  );
}

// Если браузер сам перечисляет расширения и говорит, что prf нет, —
// честный отказ ещё до системного окна. «Неизвестно» ничего не решает:
// окончательная проверка всё равно в create().
async function declaresNoPrf(api) {
  if (typeof api.getClientCapabilities !== 'function') return false;
  try {
    const caps = await api.getClientCapabilities();
    return Boolean(caps && caps['extension:prf'] === false);
  } catch {
    return false;
  }
}

// Карточка «Вход по отпечатку?» предлагается только там, где есть
// платформенный аутентификатор с проверкой пользователя. Это необходимое
// условие, а не доказательство PRF: окончательная проверка — в
// createPrfCredential/evaluatePrf при нажатии «Настроить».
export async function canOfferPasskey(env = globalThis) {
  if (!passkeyApiAvailable(env)) return false;
  const api = env.PublicKeyCredential;
  if (
    typeof api !== 'function' ||
    typeof api.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
  ) {
    return false;
  }
  if (await declaresNoPrf(api)) return false;
  try {
    return (await api.isUserVerifyingPlatformAuthenticatorAvailable()) === true;
  } catch {
    return false;
  }
}

// Что делать с карточкой после попытки настройки: оставить предложение,
// убрать его как «не поддерживается» или показать ошибку.
export function passkeyOfferState(error) {
  if (!error || isUserCancelled(error)) return 'offer';
  if (error.code === 'unsupported' || error.code === 'unstable') {
    return 'unsupported';
  }
  return 'error';
}

// Два разных адреса — не баг, а ожидаемое поведение passkey: rpId входит
// в credential и слот с localhost не сработает на домене (и наоборот).
export function prfAddressError(slot, hostname) {
  if (!slot || slot.kind !== 'prf') return null;
  const current = String(hostname ?? '').toLowerCase();
  const stored = slot.prf && typeof slot.prf.rpId === 'string' ? slot.prf.rpId : '';
  if (stored !== '' && stored.toLowerCase() === current) return null;
  return `${PASSKEY_MESSAGES.otherAddress}: ${stored || 'адрес не записан'}; здесь ${
    current || 'адрес не определён'
  }`;
}

export function prfSlotOf(vault) {
  if (!vault || !Array.isArray(vault.slots)) return null;
  return vault.slots.find((slot) => slot.kind === 'prf') ?? null;
}

function extensionResults(credential) {
  if (!credential || typeof credential.getClientExtensionResults !== 'function') {
    return {};
  }
  return credential.getClientExtensionResults() ?? {};
}

function readSecret(credential) {
  const first = extensionResults(credential).prf?.results?.first;
  if (!first) return null;
  const secret =
    first instanceof Uint8Array ? Uint8Array.from(first) : new Uint8Array(first);
  if (secret.length !== 32) {
    secret.fill(0);
    return null;
  }
  return secret;
}

// create() с prf.eval сразу возвращает секрет на части устройств: тогда
// второго системного окна не нужно. Поддержка доказана, только если ответ
// дал prf.enabled === true; секрет не 32 байта — считаем, что его нет.
export async function createPrfCredential({
  credentials,
  rpId,
  userName = 'kluchiki',
  userId,
  salt,
}) {
  if (
    !credentials ||
    typeof credentials.create !== 'function' ||
    typeof rpId !== 'string' ||
    rpId === ''
  ) {
    throw new PasskeyError('unsupported');
  }
  if (salt !== undefined && salt !== null) assertBytes(salt, 'passkey: salt');
  const user = userId ?? randomBytes(32);
  const credential = await credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { id: rpId, name: 'Kluchiki' },
      user: { id: user, name: userName, displayName: 'Kluchiki' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      extensions:
        salt === undefined || salt === null
          ? { prf: {} }
          : { prf: { eval: { first: salt } } },
    },
  });
  if (!credential || !credential.rawId) throw new PasskeyError('unsupported');
  const secret = readSecret(credential);
  if (extensionResults(credential).prf?.enabled !== true) {
    if (secret) secret.fill(0);
    throw new PasskeyError('unsupported');
  }
  const credentialId = toBase64url(new Uint8Array(credential.rawId));
  return {
    credentialId,
    prf: { credentialId, rpId },
    secret,
  };
}

// get() с фиксированной солью слота. Секрет — ровно 32 байта; отсутствие
// results или другая длина означают, что PRF на этом устройстве нет.
export async function evaluatePrf({
  credentials,
  credentialId,
  salt,
  rpId,
}) {
  assertBytes(salt, 'passkey: salt');
  if (
    !credentials ||
    typeof credentials.get !== 'function' ||
    typeof credentialId !== 'string' ||
    credentialId === ''
  ) {
    throw new PasskeyError('unsupported');
  }
  const assertion = await credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId,
      allowCredentials: [
        { type: 'public-key', id: fromBase64url(credentialId, 'passkey: credentialId') },
      ],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const secret = readSecret(assertion);
  if (!secret) throw new PasskeyError('unsupported');
  return secret;
}

// Полный путь создания слота: одно системное окно, если create() вернул
// секрет, иначе create() + один get(). Второй get() не делается: цена —
// детерминизм проверяется входом после закрытия/открытия, а не настройкой.
export async function setupPrfSlot({
  vault,
  masterKey,
  credentials,
  rpId,
  userName,
  userId,
  slotId,
}) {
  if (!vault || !Array.isArray(vault.slots)) {
    throw new TypeError('passkey: ожидалось хранилище со слотами');
  }
  const id = slotId ?? toBase64url(randomBytes(8));
  const salt = await prfSalt(id);
  const created = await createPrfCredential({
    credentials,
    rpId,
    userName,
    userId,
    salt,
  });
  let secret = created.secret;
  try {
    if (!secret) {
      secret = await evaluatePrf({
        credentials,
        credentialId: created.credentialId,
        salt,
        rpId,
      });
    }
    const next = await addSlot(
      vault,
      { kind: 'prf', secret, prf: created.prf, id },
      masterKey,
    );
    return { vault: next, slot: next.slots[next.slots.length - 1] };
  } finally {
    if (secret) secret.fill(0);
  }
}
