import axios from 'axios';
import { translate } from '../i18n/messages';
import { ensurePow, notePowExpiry } from './pow';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.response.use(
  (response) => {
    notePowExpiry(response.headers['x-pow-expires-at']);
    return response;
  },
  async (error) => {
    if (!axios.isAxiosError(error)) throw error;
    const config = error.config as (typeof error.config & { _powRetried?: boolean }) | undefined;
    if (error.response?.data?.code !== 'POW_REQUIRED' || !config || config._powRetried) {
      throw error;
    }
    config._powRetried = true;
    await ensurePow(true);
    return api.request(config);
  }
);

/** 从 axios 错误中取出后端错误码并翻译成文案 */
export function errMsg(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return translate('NETWORK_ERROR');
    const code = String(err.response.data?.code || '');
    if (code.startsWith('POW_')) return translate('NETWORK_ERROR');
    return translate(code);
  }
  return translate('INTERNAL_ERROR');
}
