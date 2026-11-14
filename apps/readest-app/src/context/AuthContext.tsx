'use client';

import {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
  useEffect,
} from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import posthog from 'posthog-js';

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('token');
    }
    return null;
  });
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const userJson = localStorage.getItem('user');
      return userJson ? JSON.parse(userJson) : null;
    }
    return null;
  });

  // Set while logout() is signing out, so the SIGNED_OUT event that follows
  // a user-initiated sign-out can be told apart from the one Supabase emits
  // when a startup refresh fails. Only the former may clear the stored
  // credentials: a failed refresh must not destroy the refresh token, or the
  // session can never be restored without signing in again (#7538).
  const signingOutRef = useRef(false);

  useEffect(() => {
    const syncSession = (
      session: { access_token: string; refresh_token: string; user: User } | null,
    ) => {
      if (session) {
        console.log('Syncing session');
        const { access_token, refresh_token, user } = session;
        // Guard the writes: a session missing a field must not store the
        // string "undefined" in localStorage, which would corrupt the next
        // launch (JSON.parse("undefined") throws in the state initializer).
        if (access_token) {
          localStorage.setItem('token', access_token);
          setToken(access_token);
        }
        if (refresh_token) {
          localStorage.setItem('refresh_token', refresh_token);
        }
        if (user) {
          localStorage.setItem('user', JSON.stringify(user));
          posthog.identify(user.id);
          setUser(user);
        }
      } else {
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      }
    };
    const restoreSession = async () => {
      // Supabase already tried to recover the stored session during client
      // init; ask it what survived before doing any network call.
      let session: {
        access_token: string;
        refresh_token: string;
        user: User;
        expires_at?: number;
      } | null = null;
      try {
        session = (await supabase.auth.getSession()).data.session;
      } catch {
        // getSession() should not throw on the real client; fall through to
        // the stored-token re-seed below.
      }
      if (session && (session.expires_at ?? 0) * 1000 - Date.now() > 60_000) {
        // Still valid: sync it and let Supabase's auto-refresh renew it in
        // the background. Forcing a refresh here is what turned a transient
        // failure into a sign-out.
        syncSession(session);
        return;
      }
      // Expired or gone: re-seed from Readest's own copy of the refresh
      // token. Supabase's copy may already be gone (its init-time refresh
      // removes the session on a non-retryable error), but ours survives
      // unless the user explicitly signed out.
      try {
        const storedRefreshToken = localStorage.getItem('refresh_token');
        const { data: refreshed, error } = storedRefreshToken
          ? await supabase.auth.refreshSession({ refresh_token: storedRefreshToken })
          : await supabase.auth.refreshSession();
        if (!error && refreshed.session) {
          syncSession(refreshed.session);
        }
      } catch {
        // A failed restore must never wipe the stored credentials: the next
        // launch can retry instead of forcing a fresh sign-in.
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) {
        syncSession(session);
      } else if (signingOutRef.current) {
        // User-initiated sign-out only. A null session after a failed
        // refresh must not wipe the stored refresh token (#7538).
        syncSession(null);
      }
    });

    restoreSession();
    return () => {
      subscription?.subscription.unsubscribe();
    };
  }, []);

  // setToken / setUser from useState are stable across renders, so the empty
  // deps array is correct. Wrapping in useCallback (and only including stable
  // refs in the deps) is what makes the useMemo below actually memoize the
  // context value — without this, login/logout/refresh would be recreated on
  // every render and the memo would always invalidate.
  const login = useCallback((newToken: string, newUser: User) => {
    console.log('Logging in');
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  }, []);

  const logout = useCallback(async () => {
    console.log('Logging out');
    try {
      await supabase.auth.refreshSession();
    } catch {
    } finally {
      signingOutRef.current = true;
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } finally {
        signingOutRef.current = false;
      }
      localStorage.removeItem('token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      return !error && !!data.session;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({ token, user, login, logout, refresh }),
    [token, user, login, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
