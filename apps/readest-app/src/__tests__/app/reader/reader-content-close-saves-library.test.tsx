// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Profiler } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';

import type { Book, BookConfig } from '@/types/book';
import type { SystemSettings } from '@/types/settings';

const h = vi.hoisted(() => {
  const appService = {
    hasWindow: true,
    isDesktopApp: false,
    saveSettings: vi.fn(async () => {}),
    saveBookConfig: vi.fn(async () => {}),
    saveLibraryBooks: vi.fn(async (_books: unknown[]) => {}),
  };
  return {
    appService,
    envConfig: { getAppService: async () => appService },
    onCloseWindow: vi.fn(async (_callback: () => unknown) => () => {}),
    windowLabel: 'main',
    closeWindow: vi.fn(async () => {}),
    bookKeys: ['h1-k1'],
    onCloseBook: null as ((bookKey: string) => unknown) | null,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => null,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: h.envConfig, appService: h.appService }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useAndroidGamepadConnection', () => ({
  useAndroidGamepadConnection: () => false,
}));
vi.mock('@/hooks/useGamepad', () => ({ useGamepad: () => {} }));
vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({ bookKeys: h.bookKeys, dismissBook: vi.fn(), getNextBookKey: vi.fn() }),
}));
vi.mock('@/app/reader/hooks/useBookShortcuts', () => ({ default: () => {} }));
vi.mock('@/app/reader/hooks/useNotebookDocumentCoordinator', () => ({
  flushNotebookDocument: async () => ({ ok: true }),
  discardNotebookDocument: vi.fn(),
}));
vi.mock('@/app/reader/services/notebookDocumentCoordinator', () => ({
  canTransitionWithNotebookRecovery: () => true,
}));
vi.mock('@/utils/window', () => ({
  tauriHandleClose: vi.fn(),
  tauriHandleOnCloseWindow: h.onCloseWindow,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: h.windowLabel, close: h.closeWindow }),
}));
vi.mock('@/utils/discord', () => ({ clearDiscordPresence: vi.fn() }));
vi.mock('@/app/reader/components/sidebar/SideBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/Notebook', () => ({ default: () => null }));
vi.mock('@/app/reader/components/notebook/NotebookTransitionAlert', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/BooksGrid', () => ({
  default: (props: { onCloseBook?: (bookKey: string) => unknown }) => {
    h.onCloseBook = props.onCloseBook ?? null;
    return null;
  },
}));
vi.mock('@/app/reader/components/audiobook/AudiobookPairingDialog', () => ({
  default: () => null,
}));
vi.mock('@/app/reader/components/hardcover/HardcoverLinkDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/pagebound/PageboundLinkDialog', () => ({ default: () => null }));
vi.mock('@/components/localsend/LocalSendManager', () => ({ default: () => null }));
vi.mock('@/components/settings/SettingsDialog', () => ({ default: () => null }));
vi.mock('@/components/metadata', () => ({ BookDetailModal: () => null }));
vi.mock('@/app/library/components/ShareBookDialog', () => ({ default: () => null }));

vi.mock('@/helpers/openWith', () => ({
  parseOpenWithFiles: async () => [],
}));

import ReaderContent from '@/app/reader/components/ReaderContent';
import { eventDispatcher } from '@/utils/event';
import { flushPendingLibrarySave, useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';

const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'Book',
  author: 'Author',
  progress: [27, 39],
  createdAt: 1,
  updatedAt: 1,
} as Book;

describe('ReaderContent window close', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.getState().setLibrary([book]);
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book,
          file: null,
          config: { progress: [29, 39], location: 'cfi-29', updatedAt: 1 } as BookConfig,
          bookDoc: null,
          isFixedLayout: false,
        },
      },
    });
    useReaderStore.setState({
      viewStates: {
        'h1-k1': { key: 'h1-k1', isPrimary: true } as NonNullable<
          ReturnType<ReturnType<typeof useReaderStore.getState>['getViewState']>
        >,
      },
    });
  });

  afterEach(async () => {
    cleanup();
    await flushPendingLibrarySave();
  });

  // Closing the reader window quits the app on Windows/Linux: the close
  // handler must not resolve until the library row carries the final
  // progress, or the shelf shows the old percentage on next launch (#6623).
  test('saves the library progress before the window is allowed to close', async () => {
    render(<ReaderContent settings={{} as SystemSettings} />);
    await waitFor(() => expect(h.onCloseWindow).toHaveBeenCalled());

    const onClose = h.onCloseWindow.mock.calls.at(-1)![0];
    await onClose();

    expect(h.appService.saveLibraryBooks).toHaveBeenCalled();
    const saved = h.appService.saveLibraryBooks.mock.calls.at(-1)![0] as Book[];
    expect(saved.find((b) => b.hash === 'h1')?.progress).toEqual([29, 39]);
  });
});

describe('ReaderContent subscriptions', () => {
  beforeEach(() => {
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book,
          file: null,
          config: { progress: [29, 39], location: 'cfi-29', updatedAt: 1 } as BookConfig,
          bookDoc: {} as NonNullable<
            ReturnType<typeof useBookDataStore.getState>['booksData'][string]
          >['bookDoc'],
          isFixedLayout: false,
        },
      },
    });
    useReaderStore.setState({
      viewStates: {
        'h1-k1': { key: 'h1-k1', isPrimary: true, viewSettings: {} } as NonNullable<
          ReturnType<ReturnType<typeof useReaderStore.getState>['getViewState']>
        >,
      },
    });
  });

  afterEach(async () => {
    cleanup();
    await flushPendingLibrarySave();
  });

  // Every page turn writes the book's progress into its config; the reader below must not
  // re-render for it
  test('a progress write does not re-render it; a new book document does', async () => {
    const onRender = vi.fn();
    const { container } = render(
      <Profiler id='reader' onRender={onRender}>
        <ReaderContent settings={{} as SystemSettings} />
      </Profiler>,
    );
    await waitFor(() => expect(container.querySelector('.reader-content')).not.toBeNull());
    await act(async () => {});
    onRender.mockClear();
    act(() =>
      useBookDataStore.setState((state) => ({
        booksData: {
          ...state.booksData,
          h1: {
            ...state.booksData['h1']!,
            config: { ...state.booksData['h1']!.config!, progress: [30, 39], location: 'cfi-30' },
          },
        },
      })),
    );
    expect(onRender).not.toHaveBeenCalled();
    act(() =>
      useBookDataStore.setState((state) => ({
        booksData: { ...state.booksData, h1: { ...state.booksData['h1']!, bookDoc: null } },
      })),
    );
    expect(onRender).toHaveBeenCalled();
    expect(container.querySelector('.reader-content')).toBeNull();
  });
});

describe('ReaderContent closing a book stops narration when the window goes with it', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.windowLabel = 'main';
    h.bookKeys = ['h1-k1'];
    h.onCloseBook = null;
    useLibraryStore.getState().setLibrary([book]);
    useBookDataStore.setState({
      booksData: {
        h1: {
          id: 'h1',
          book,
          file: null,
          config: { progress: [29, 39], location: 'cfi-29', updatedAt: 1 } as BookConfig,
          bookDoc: {} as NonNullable<
            ReturnType<typeof useBookDataStore.getState>['booksData'][string]
          >['bookDoc'],
          isFixedLayout: false,
        },
      },
    });
    useReaderStore.setState({
      viewStates: {
        'h1-k1': { key: 'h1-k1', isPrimary: true, viewSettings: {} } as NonNullable<
          ReturnType<ReturnType<typeof useReaderStore.getState>['getViewState']>
        >,
      },
    });
  });

  afterEach(async () => {
    cleanup();
    await flushPendingLibrarySave();
    vi.restoreAllMocks();
  });

  const closeBookAndSpyTTS = async (bookKey: string) => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    render(<ReaderContent settings={{} as SystemSettings} />);
    await waitFor(() => expect(h.onCloseBook).not.toBeNull());
    await act(async () => {
      await h.onCloseBook!(bookKey);
    });
    return dispatchSpy.mock.calls
      .filter(([event]) => event === 'tts-stop' || event === 'tts-close-book')
      .map(([event, detail]) => [event, detail]);
  };

  // Closing the last book in a reader window destroys the webview, so the
  // native narration player (which outlives the webview) must be stopped
  // before the close — detaching it to headless leaves it playing (#7523).
  test('closing the last book in a reader window hard-stops TTS', async () => {
    h.windowLabel = 'reader-1';
    const ttsEvents = await closeBookAndSpyTTS('h1-k1');
    expect(ttsEvents).toEqual([['tts-stop', { bookKey: 'h1-k1' }]]);
    expect(h.closeWindow).toHaveBeenCalled();
  });

  // The main window stays alive, so closing the last book there may keep
  // the narration playing headless by design.
  test('closing the last book in the main window keeps headless playback', async () => {
    const ttsEvents = await closeBookAndSpyTTS('h1-k1');
    expect(ttsEvents).toEqual([['tts-close-book', { bookKey: 'h1-k1' }]]);
    expect(h.closeWindow).not.toHaveBeenCalled();
  });

  // Closing one pane of several leaves the window (and the narration) alive.
  test('closing a non-last book keeps headless playback', async () => {
    h.bookKeys = ['h1-k1', 'h2-k2'];
    h.windowLabel = 'reader-1';
    const ttsEvents = await closeBookAndSpyTTS('h1-k1');
    expect(ttsEvents).toEqual([['tts-close-book', { bookKey: 'h1-k1' }]]);
    expect(h.closeWindow).not.toHaveBeenCalled();
  });
});
