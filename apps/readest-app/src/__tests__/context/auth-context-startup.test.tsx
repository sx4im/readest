// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  callback: null as ((event: string, session: unknown) => void) | null,
}));
vi.mock('@/utils/supabase', () => ({
  supabase: {
    auth: {
      refreshSession: mocks.refreshSession,
      getSession: mocks.getSession,
      signOut: mocks.signOut,
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mocks.callback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn() } }));

const storedUser = { id: 'u1', email: 'u1@example.com' };
const liveSession = {
  access_token: 'live-token',
  refresh_token: 'live-refresh',
  user: storedUser,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'old-token');
  localStorage.setItem('refresh_token', 'stored-refresh');
  localStorage.setItem('user', JSON.stringify(storedUser));
  vi.clearAllMocks();
  mocks.callback = null;
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

it('re-seeds the session from the stored refresh token when Supabase lost it', async () => {
  mocks.refreshSession.mockResolvedValue({
    data: { session: { ...liveSession, access_token: 'new-token' } },
    error: null,
  });
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() =>
    expect(mocks.refreshSession).toHaveBeenCalledWith({ refresh_token: 'stored-refresh' }),
  );
  await waitFor(() => expect(result.current.token).toBe('new-token'));
  expect(localStorage.getItem('token')).toBe('new-token');
  expect(localStorage.getItem('refresh_token')).toBe('live-refresh');
});

it('keeps the stored refresh token when the re-seed fails', async () => {
  mocks.refreshSession.mockResolvedValue({
    data: { session: null },
    error: new Error('invalid_grant'),
  });
  renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() =>
    expect(mocks.refreshSession).toHaveBeenCalledWith({ refresh_token: 'stored-refresh' }),
  );
  // Supabase reports the failed refresh as a null session; that must not
  // destroy the only credential that can restore the session on next launch.
  mocks.callback?.('SIGNED_OUT', null);
  expect(localStorage.getItem('refresh_token')).toBe('stored-refresh');
  expect(localStorage.getItem('token')).toBe('old-token');
  expect(localStorage.getItem('user')).toBe(JSON.stringify(storedUser));
});

it('does not force a refresh when the stored session is still valid', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: liveSession }, error: null });
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.token).toBe('live-token'));
  expect(mocks.refreshSession).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBe('live-token');
});

it('still wipes stored credentials on an explicit sign-out', async () => {
  const { result } = renderHook(useAuth, { wrapper: AuthProvider });
  await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
  await result.current.logout();
  expect(mocks.signOut).toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('refresh_token')).toBeNull();
  expect(localStorage.getItem('user')).toBeNull();
  await waitFor(() => expect(result.current.token).toBeNull());
});
