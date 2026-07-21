import axios from 'axios';
import { useAuth } from '../store/auth';
import { UserInfo } from '../types';
import { ensurePow } from './pow';

const AUTH_HINT = 'csgofriberg_auth_hint';
const GUEST_HINT = 'csgofriberg_guest_hint';
const authApi = axios.create({ baseURL: '/api', withCredentials: true });

let refreshRequest: Promise<boolean> | null = null;

export function markAuthenticated(): void {
  localStorage.setItem(AUTH_HINT, '1');
}

export function clearAuthenticated(): void {
  localStorage.removeItem(AUTH_HINT);
  localStorage.removeItem(GUEST_HINT);
}

export function markGuestSession(): void {
  localStorage.setItem(GUEST_HINT, '1');
}

export function hasAuthHint(): boolean {
  return localStorage.getItem(AUTH_HINT) === '1';
}

export function hasGuestHint(): boolean {
  return localStorage.getItem(GUEST_HINT) === '1';
}

async function requestRefresh(retriedPow = false): Promise<boolean> {
  await ensurePow(retriedPow);
  try {
    const response = await authApi.post<{ user: UserInfo }>('/auth/refresh');
    markAuthenticated();
    useAuth.getState().setUser(response.data.user);
    return true;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response?.data?.code === 'POW_REQUIRED' &&
      !retriedPow
    ) {
      return requestRefresh(true);
    }
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearAuthenticated();
      useAuth.getState().setUser(null);
      return false;
    }
    throw error;
  }
}

export function refreshAuthenticatedSession(): Promise<boolean> {
  if (!hasAuthHint()) return Promise.resolve(false);
  refreshRequest ??= requestRefresh().finally(() => {
    refreshRequest = null;
  });
  return refreshRequest;
}
