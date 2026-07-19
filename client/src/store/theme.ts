export type Theme = 'blast' | 'light';

const STORAGE_KEY = 'ui-theme';
const STYLESHEET_ID = 'blast-theme-stylesheet';
const listeners = new Set<() => void>();

function storedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'blast';
  } catch {
    return 'blast';
  }
}

let currentTheme = storedTheme();

function blastStylesheet(): HTMLLinkElement | null {
  const link = document.getElementById(STYLESHEET_ID);
  return link instanceof HTMLLinkElement ? link : null;
}

function renderTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'blast' ? 'dark' : 'light';
  document.documentElement.style.background = theme === 'blast' ? '#160a13' : '#edf3fb';
  const stylesheet = blastStylesheet();
  if (stylesheet) stylesheet.media = theme === 'blast' ? 'all' : 'not all';
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'blast' ? '#160a13' : '#edf3fb'
  );
}

export function initializeTheme(): void {
  currentTheme = storedTheme();
  renderTheme(currentTheme);
}

export function getTheme(): Theme {
  return currentTheme;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTheme(theme: Theme): void {
  if (theme === currentTheme) return;
  currentTheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Theme switching still works when storage is unavailable.
  }
  renderTheme(theme);
  for (const listener of listeners) listener();
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  const theme: Theme = event.newValue === 'light' ? 'light' : 'blast';
  if (theme === currentTheme) return;
  currentTheme = theme;
  renderTheme(theme);
  for (const listener of listeners) listener();
});
