import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

export const supportedLanguages = ['zh', 'en', 'ja'] as const;
export type AppLanguage = (typeof supportedLanguages)[number];

const STORAGE_KEY = 'csgofriberg_language';

function normalizeLanguage(value: string | null | undefined): AppLanguage | null {
  const language = value?.toLowerCase().split('-')[0];
  return supportedLanguages.find((candidate) => candidate === language) ?? null;
}

function detectLanguage(): AppLanguage {
  try {
    const stored = normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Browser storage can be disabled; language detection should still work.
  }
  for (const language of navigator.languages ?? [navigator.language]) {
    const supported = normalizeLanguage(language);
    if (supported) return supported;
  }
  return 'zh';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  initAsync: false,
  fallbackLng: 'zh',
  supportedLngs: [...supportedLanguages],
  interpolation: { escapeValue: false },
  returnNull: false,
});

function applyLanguage(language: string): void {
  const normalized = normalizeLanguage(language) ?? 'zh';
  document.documentElement.lang = normalized === 'zh' ? 'zh-CN' : normalized;
  try {
    localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // The active language still applies when persistence is unavailable.
  }
}

applyLanguage(i18n.language);
i18n.on('languageChanged', applyLanguage);

export function currentLocale(): string {
  const language = normalizeLanguage(i18n.language) ?? 'zh';
  return language === 'zh' ? 'zh-CN' : language === 'ja' ? 'ja-JP' : 'en-US';
}

export default i18n;
