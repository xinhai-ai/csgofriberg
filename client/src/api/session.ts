import { api } from './client';
import { useAuth } from '../store/auth';
import { UserInfo } from '../types';
import axios from 'axios';
import { hasGuestName, setGuestName } from '../store/guest';
import {
  clearAuthenticated,
  hasAuthHint,
  hasGuestHint,
  markAuthenticated,
  markGuestSession,
} from './authSession';

let guestRequest: Promise<void> | null = null;

interface SessionResponse {
  authenticated: boolean;
  user?: UserInfo;
  guest?: { name: string };
}

export { clearAuthenticated, hasAuthHint, markAuthenticated, markGuestSession };

export function ensureGuestSession(force = false): Promise<void> {
  if (!force && hasGuestHint() && hasGuestName()) {
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
