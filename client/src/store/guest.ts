const GUEST_NAME = 'guestName';

export function getGuestName(): string {
  return localStorage.getItem(GUEST_NAME) ?? '匿名访客';
}

export function setGuestName(name: string) {
  localStorage.setItem(GUEST_NAME, name.trim().slice(0, 16));
}
