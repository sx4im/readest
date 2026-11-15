// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  appService: {
    isIOSApp: false,
    hasWindow: false,
    loadSettings: vi.fn(async () => ({ autoImportBooksOnOpen: true })),
  },
  navigateToLibrary: vi.fn(),
  setCheckOpenWithBooks: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getAllWindows: vi.fn(),
  getCurrentWindow: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: h.appService }) }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => true }));
vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return {
    useLibraryStore: create(() => ({
      library: [],
      setCheckOpenWithBooks: h.setCheckOpenWithBooks,
    })),
  };
});
vi.mock('@/utils/nav', () => ({
  navigateToLibrary: h.navigateToLibrary,
  navigateToReader: vi.fn(),
  showLibraryWindow: vi.fn(),
}));
vi.mock('@/utils/md5', () => ({ partialMD5: vi.fn() }));

import { useOpenWithBooks } from '@/hooks/useOpenWithBooks';
import { eventDispatcher } from '@/utils/event';

afterEach(() => {
  cleanup();
  delete window.OPEN_WITH_FILES;
  vi.clearAllMocks();
});

describe('useOpenWithBooks desktop file URL ingress', () => {
  // A filename ending in `;` opened from Finder/Calibre arrives
  // percent-encoded (`%3B`). The live-event path must hand the library a
  // real filesystem path, not one with a literal `%3B` in it (#7553).
  test.each([
    [
      'Eros_the_Bittersweet__An_Essay_-_Anne_Carson%3B.epub',
      'Eros_the_Bittersweet__An_Essay_-_Anne_Carson;.epub',
    ],
    ['A%23B.epub', 'A#B.epub'],
  ])('decodes percent-encoded reserved characters in file names (%s)', async (encoded, decoded) => {
    const uri = `file:///Users/x/Books/${encoded}`;
    renderHook(() => useOpenWithBooks());
    act(() => {
      eventDispatcher.dispatch('app-incoming-url', { urls: [uri] });
    });
    await waitFor(() => expect(h.navigateToLibrary).toHaveBeenCalledTimes(1));
    expect(window.OPEN_WITH_FILES).toEqual([`/Users/x/Books/${decoded}`]);
    expect(h.setCheckOpenWithBooks).toHaveBeenCalledWith(true);
  });

  test('does not throw on a malformed percent sequence', async () => {
    const uri = 'file:///Users/x/Books/100%.epub';
    renderHook(() => useOpenWithBooks());
    act(() => {
      eventDispatcher.dispatch('app-incoming-url', { urls: [uri] });
    });
    await waitFor(() => expect(h.navigateToLibrary).toHaveBeenCalledTimes(1));
    expect(window.OPEN_WITH_FILES).toEqual(['/Users/x/Books/100%.epub']);
  });
});
