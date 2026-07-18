import { api } from './client';
import { ensurePow } from './pow';
import { useAuth } from '../store/auth';
import { UserInfo } from '../types';
import axios from 'axios';
import { hasGuestName, setGuestName } from '../store/guest';

const AUTH_HINT = 'csgofriberg_auth_hint';
const GUEST_HINT = 'csgofriberg_guest_hint';

let guestRequest: Promise<void> | null = null;

interface SessionResponse {
  authenticated: boolean;
  user?: UserInfo;
  guest?: { name: string };
}

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

function hasGuestHint(): boolean {
  return localStorage.getItem(GUEST_HINT) === '1';
}

export function ensureGuestSession(force = false): Promise<void> {
  if (!force && localStorage.getItem(GUEST_HINT) === '1' && hasGuestName()) {
    return Promise.resolve();
  }
  if (guestRequest) return guestRequest;
  guestRequest = api.post<SessionResponse>('/auth/session').then((response) => {
    if (response.data.authenticated && response.data.user) {
      markAuthenticated();
      useAuth.getState().setUser(response.data.user);
    } else {
      markGuestSession();
      if (response.data.guest?.name) setGuestName(response.data.guest.name);
    }
  }).finally(() => {
    guestRequest = null;
  });
  return guestRequest;
}

export async function initializeIdentity(): Promise<void> {
  const auth = useAuth.getState();
  if (!hasAuthHint()) {
    auth.setInitialized();
    if (!hasGuestHint() || !hasGuestName()) void ensureGuestSession().catch(() => undefined);
    return;
  }
  try {
    const response = await api.get('/auth/me');
    auth.setUser(response.data.user);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      clearAuthenticated();
    }
    auth.setUser(null);
  } finally {
    auth.setInitialized();
  }
}
