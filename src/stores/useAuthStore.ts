import { create } from 'zustand';
import { apiFetch, setMemoryBearerToken } from '../lib/api.ts';
import type { AuthUser, AuthorProfile, UserProfile } from '../types/litera.ts';

interface AuthMeResponse {
  user: AuthUser | null;
  profile: UserProfile | null;
  authorProfile: AuthorProfile | null;
  unreadNotifications: number;
}

interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  authorProfile: AuthorProfile | null;
  unreadNotifications: number;
  initialized: boolean;
  authModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  setSession: (payload: {
    user: AuthUser | null;
    token?: string | null;
    profile?: UserProfile | null;
    authorProfile?: AuthorProfile | null;
  }) => void;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  authorProfile: null,
  unreadNotifications: 0,
  initialized: false,
  authModalOpen: false,

  setAuthModalOpen: (open) => set({ authModalOpen: open }),

  setSession: ({ user, token, profile, authorProfile }) => {
    if (token !== undefined) {
      setMemoryBearerToken(token);
    }
    set((state) => ({
      user,
      profile: profile !== undefined ? profile : state.profile,
      authorProfile: authorProfile !== undefined ? authorProfile : state.authorProfile,
      initialized: true,
    }));
  },

  refreshMe: async () => {
    try {
      const res = await apiFetch<AuthMeResponse>('/api/auth/me');
      set({
        user: res.user,
        profile: res.profile,
        authorProfile: res.authorProfile,
        unreadNotifications: res.unreadNotifications,
        initialized: true,
      });
    } catch {
      set({
        user: null,
        profile: null,
        authorProfile: null,
        unreadNotifications: 0,
        initialized: true,
      });
    }
  },

  logout: async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout cleanup
    }
    setMemoryBearerToken(null);
    set({
      user: null,
      profile: null,
      authorProfile: null,
      unreadNotifications: 0,
    });
  },
}));
