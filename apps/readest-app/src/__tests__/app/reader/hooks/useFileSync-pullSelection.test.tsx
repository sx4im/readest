// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

// Readest #7522: a remote progress pull must not yank the live view out
// from under a text selection. A pull that lands while the user is
// selecting applies the remote position with view.goTo, which re-renders
// the section and clears the in-progress selection — the reporter saw
// exactly that as the selection vanishing plus a "Reading Progress Synced"
// hint at the same moment. The merged config is still stored, so the next
// open resolves to the synced position normally (the same reasoning as the
// existing previewMode guard).

const REMOTE_LOCATION = 'epubcfi(/6/8)';
const LOCAL_LOCATION = 'epubcfi(/6/4)';

const h = vi.hoisted(() => {
  const settings = { webdav: { enabled: true, serverUrl: 'https://dav', strategy: 'silent' } };
  const book = { hash: 'h1', title: 'Dune', format: 'EPUB' };
  // Literal here: vi.hoisted runs before the module-level consts below.
  const config = { booknotes: [], location: 'epubcfi(/6/4)' };
  const data = {
    getConfig: () => config,
    setConfig: vi.fn(),
    getBookData: () => ({ book }),
    saveConfig: vi.fn(async () => {}),
  };
  const store = { settings, setSettings: vi.fn(), saveSettings: vi.fn(async () => {}) };
  const view = {
    goTo: vi.fn(async () => {}),
    goToFraction: vi.fn(async () => {}),
    renderer: { getContents: () => [{ doc: document, index: 0 }] },
  };
  return {
    env: { appService: {}, envConfig: {} },
    translate: (s: string) => s,
    data,
    store,
    view,
    pushBookConfig: vi.fn(),
    pullBookConfig: vi.fn(),
    pushBookFile: vi.fn(),
    pushBookCover: vi.fn(),
  };
});

vi.mock('@/context/EnvContext', () => ({ useEnv: () => h.env }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => h.translate }));
vi.mock('@/hooks/useQuotaStats', () => ({ useQuotaStats: () => ({ userProfilePlan: 'pro' }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (s: typeof h.data) => unknown) => selector(h.data),
}));
vi.mock('@/store/readerStore', () => {
  const state = {
    getViewsById: () => [],
    getView: () => h.view,
    getViewState: () => ({ previewMode: false }),
  };
  return {
    useReaderStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
    }),
  };
});
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ location: LOCAL_LOCATION }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => h.store, { getState: () => h.store }),
}));
vi.mock('@/services/sync/file/providerRegistry', () => ({
  createFileSyncProvider: vi.fn(async () => ({})),
}));
vi.mock('@/services/sync/file/appLocalStore', () => ({ createAppLocalStore: () => ({}) }));
vi.mock('@/services/sync/file/runLibrarySync', () => ({ canBackendRun: () => true }));
vi.mock('@/services/sync/file/engine', () => ({
  FileSyncEngine: class {
    pushBookConfig = h.pushBookConfig;
    pullBookConfig = h.pullBookConfig;
    pushBookFile = h.pushBookFile;
    pushBookCover = h.pushBookCover;
  },
}));
vi.mock('@/app/reader/hooks/useWindowActiveChanged', () => ({ useWindowActiveChanged: () => {} }));

import { useFileSync } from '@/app/reader/hooks/useFileSync';

const selectText = () => {
  const node = document.createTextNode('Call me Ishmael.');
  document.body.appendChild(node);
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 4);
  document.getSelection()!.addRange(range);
};

describe('useFileSync pull while text is selected', () => {
  beforeEach(() => {
    localStorage.clear();
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    h.pushBookConfig.mockReset().mockResolvedValue(undefined);
    // The remote holds a newer position than this device.
    h.pullBookConfig.mockReset().mockResolvedValue({
      applied: true,
      changed: true,
      mergedConfig: { booknotes: [], location: REMOTE_LOCATION },
    });
    h.pushBookFile.mockReset().mockResolvedValue({ uploaded: false });
    h.pushBookCover.mockReset().mockResolvedValue(undefined);
    h.data.setConfig.mockReset();
    h.view.goTo.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test('jumps the live view to the remote position when nothing is selected', async () => {
    renderHook(() => useFileSync('k'));

    await waitFor(() => expect(h.view.goTo).toHaveBeenCalledWith(REMOTE_LOCATION));
    expect(h.data.setConfig).toHaveBeenCalledWith(
      'k',
      expect.objectContaining({ location: REMOTE_LOCATION }),
    );
  });

  test('does not jump the live view while text is selected', async () => {
    selectText();
    expect(document.getSelection()?.isCollapsed).toBe(false);

    renderHook(() => useFileSync('k'));

    // The merged config is still stored, so the next open resolves to the
    // synced position normally — only the live-view jump is skipped.
    await waitFor(() =>
      expect(h.data.setConfig).toHaveBeenCalledWith(
        'k',
        expect.objectContaining({ location: REMOTE_LOCATION }),
      ),
    );
    // Let any pending jump land if the guard is missing.
    await new Promise((r) => setTimeout(r, 50));
    expect(h.view.goTo).not.toHaveBeenCalled();
  });

  test('does not jump for a collapsed caret (no live selection)', async () => {
    const node = document.createTextNode('Call me Ishmael.');
    document.body.appendChild(node);
    const range = document.createRange();
    range.setStart(node, 0);
    range.collapse(true);
    document.getSelection()!.addRange(range);
    expect(document.getSelection()?.isCollapsed).toBe(true);

    renderHook(() => useFileSync('k'));

    await waitFor(() => expect(h.view.goTo).toHaveBeenCalledWith(REMOTE_LOCATION));
  });
});
