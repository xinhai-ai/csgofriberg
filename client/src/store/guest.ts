const GUEST_NAME = 'guestName';
const GUEST_NAME_CHANGED = 'csgofriberg:guest-name-changed';

export function getGuestName(): string {
  return localStorage.getItem(GUEST_NAME) ?? '访客';
}

export function hasGuestName(): boolean {
  return /^访客#[0-9A-Z]{5}$/.test(localStorage.getItem(GUEST_NAME) ?? '');
}

export function setGuestName(name: string): void {
  const normalized = name.trim().slice(0, 16);
  if (!/^访客#[0-9A-Z]{5}$/.test(normalized)) return;
  localStorage.setItem(GUEST_NAME, normalized);
  window.dispatchEvent(new Event(GUEST_NAME_CHANGED));
}

export function subscribeGuestName(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === GUEST_NAME) listener();
  };
  window.addEventListener(GUEST_NAME_CHANGED, listener);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(GUEST_NAME_CHANGED, listener);
    window.removeEventListener('storage', handleStorage);
  };
}
