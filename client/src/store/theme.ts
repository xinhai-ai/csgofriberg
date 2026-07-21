import blastFoundationUrl from '../styles/themes/blast-foundation.css?url';
import blastPagesUrl from '../styles/themes/blast-pages.css?url';
import blastResponsiveUrl from '../styles/themes/blast-responsive.css?url';

export type Theme = 'blast' | 'light';

const STORAGE_KEY = 'ui-theme';
const STYLESHEET_SELECTOR = 'link[data-blast-theme]';
const BLAST_STYLESHEET_URLS = [blastFoundationUrl, blastPagesUrl, blastResponsiveUrl];
const listeners = new Set<() => void>();

function storedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'blast';
  } catch {
    return 'blast';
  }
}

let currentTheme = storedTheme();

function blastStylesheets(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>(STYLESHEET_SELECTOR)];
}

function installBlastStylesheets(): void {
  if (blastStylesheets().length) return;
  for (const href of BLAST_STYLESHEET_URLS) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href;
    stylesheet.dataset.blastTheme = '';
    document.head.append(stylesheet);
  }
}

function renderTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'blast' ? 'dark' : 'light';
  document.documentElement.style.background = theme === 'blast' ? '#160a13' : '#edf3fb';
  for (const stylesheet of blastStylesheets()) {
    stylesheet.media = theme === 'blast' ? 'all' : 'not all';
  }
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'blast' ? '#160a13' : '#edf3fb'
  );
}

export function initializeTheme(): void {
  installBlastStylesheets();
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
