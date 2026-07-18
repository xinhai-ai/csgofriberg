import axios from 'axios';
import { translate } from '../i18n/messages';
import { getGuestKey } from '../store/guest';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['X-Guest-Key'] = getGuestKey();
  return config;
});

/** 从 axios 错误中取出后端错误码并翻译成文案 */
export function errMsg(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return translate('NETWORK_ERROR');
    return translate(err.response.data?.code);
  }
  return translate('INTERNAL_ERROR');
}
