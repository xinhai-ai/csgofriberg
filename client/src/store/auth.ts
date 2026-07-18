import { create } from 'zustand';
import { UserInfo } from '../types';

interface AuthState {
  user: UserInfo | null;
  initialized: boolean;
  setUser: (user: UserInfo | null) => void;
  setInitialized: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  setUser: (user) => set({ user }),
  setInitialized: () => set({ initialized: true }),
}));
