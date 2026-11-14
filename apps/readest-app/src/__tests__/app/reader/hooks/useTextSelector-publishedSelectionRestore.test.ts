// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// #7522: in books with Media Overlays the DOM selection is dropped in the same
// frame the annotation popup shows, before the user makes any new gesture.
// That gesture-less clear must put the just-published selection back instead
// of dismissing the popup it just opened. A real dismiss always starts with
// a pointer press, so only a clear with no new gesture behind it is restored.

const h = vi.hoisted(() => ({
  view: {
    deselect: vi.fn(),
    getCFI: () => 'fake-cfi',
    renderer: { containerPosition: 0, getContents: () => [] },
  },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false, isMobile: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => ({ scrolled: false }),
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ isFixedLayout: true }) })),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => 'windows' };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';

const mousePointer = (x: number, y: number) =>
  ({ pointerType: 'mouse', button: 0, clientX: x, clientY: y }) as PointerEvent;

const setup = () => {
  const handleDismissPopup = vi.fn();
  const setSelection = vi.fn();
  const noop = vi.fn();
  const { result } = renderHook(() =>
    useTextSelector(
      'book-1',
      { top: 0, right: 0, bottom: 0, left: 0 },
      setSelection,
      noop,
      noop,
      vi.fn(async () => ''),
      handleDismissPopup,
    ),
  );
  return { result, handleDismissPopup, setSelection };
};

const selectText = () => {
  const node = document.createTextNode('Hello world test');
  document.body.appendChild(node);
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 5);
  // jsdom has no layout: put the selected text at (50, 50).
  Object.assign(range, {
    getClientRects: () => [{ left: 40, right: 60, top: 45, bottom: 55 }],
  });
  document.getSelection()!.addRange(range);
};

// A drag that publishes a selection: press with nothing selected, the drag
// creates it, release publishes it.
const dragSelect = async (result: ReturnType<typeof setup>['result']) => {
  result.current.handlePointerDown(document, 0, mousePointer(5, 5));
  selectText();
  await result.current.handlePointerUp(document, 0, mousePointer(500, 500));
  await vi.waitFor(() => expect(result.current.isTextSelected.current).toBe(true));
};

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('a selection the engine drops right after publish (#7522)', () => {
  test('restores the just-published selection instead of dismissing', async () => {
    const { result, handleDismissPopup, setSelection } = setup();
    await dragSelect(result);
    expect(setSelection).toHaveBeenCalledOnce();

    // The engine empties the DOM selection with no new gesture.
    document.getSelection()!.removeAllRanges();
    result.current.handleSelectionchange(document, 0);

    expect(handleDismissPopup).not.toHaveBeenCalled();
    expect(document.getSelection()?.toString()).toBe('Hello');
    expect(result.current.isTextSelected.current).toBe(true);
  });

  test('still dismisses when the user taps to clear it', async () => {
    const { result, handleDismissPopup } = setup();
    await dragSelect(result);

    // A tap on empty space: a new press starts, the selection clears, the
    // release dismisses.
    result.current.handlePointerDown(document, 0, mousePointer(5, 5));
    document.getSelection()!.removeAllRanges();
    result.current.handleSelectionchange(document, 0);
    expect(handleDismissPopup).not.toHaveBeenCalled();

    await result.current.handlePointerUp(document, 0, mousePointer(5, 5));

    expect(handleDismissPopup).toHaveBeenCalledOnce();
    expect(result.current.isTextSelected.current).toBe(false);
  });

  test('does not resurrect a selection cleared long after publish', async () => {
    const { result, handleDismissPopup } = setup();
    await dragSelect(result);

    // More than the restore window after the publish, the clear is a real
    // dismiss (e.g. Escape or an arrow key collapsing the selection).
    const nowSpy = vi.spyOn(Date, 'now');
    const publishedAt = Date.now();
    nowSpy.mockReturnValue(publishedAt + 10_000);
    document.getSelection()!.removeAllRanges();
    result.current.handleSelectionchange(document, 0);

    expect(handleDismissPopup).toHaveBeenCalledOnce();
    expect(document.getSelection()?.toString()).toBe('');
    expect(result.current.isTextSelected.current).toBe(false);
  });
});
