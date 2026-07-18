/**
 * 匿名访客身份与本地进度:
 * - guestKey 持久存 localStorage,作为匿名对局的服务端记账标识
 * - 登录后调用 /auth/claim 把匿名对局并入账号
 */

const GUEST_KEY = 'guestKey';
const GUEST_NAME = 'guestName';

export function getGuestKey(): string {
  let key = localStorage.getItem(GUEST_KEY);
  if (!key) {
    key =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(GUEST_KEY, key);
  }
  return key;
}

export function getGuestName(): string {
  return localStorage.getItem(GUEST_NAME) ?? `访客${getGuestKey().slice(0, 4)}`;
}

export function setGuestName(name: string) {
  localStorage.setItem(GUEST_NAME, name.trim().slice(0, 16));
}
