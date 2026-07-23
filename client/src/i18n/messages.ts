import i18n from './index';

export function translate(code: string | undefined | null): string {
  if (!code) return i18n.t('errors.INTERNAL_ERROR');
  const key = `errors.${code}`;
  return i18n.exists(key) ? i18n.t(key) : i18n.t('errors.UNKNOWN', { code });
}
