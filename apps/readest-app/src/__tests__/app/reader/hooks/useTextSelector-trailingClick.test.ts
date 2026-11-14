// Full-chain reproduction for readest/readest#7522: the TRAILING CLICK.
//
// The opener's useTextSelector-mediaOverlay test drives pointerdown ->
// native selection -> selectionchange -> pointerup -> publish, and proves
// the selection publishes over the real book. It never drives the trailing
// `click`: on desktop the iframe click handler defers the single click by
// DOUBLE_CLICK_INTERVAL_THRESHOLD_MS (250ms) and then posts
// `iframe-single-click`, which the hook's handleSingleClick answers —
// consuming the `isUpToPopup` latch set at pointerup, or (latch clear)
// dismissing the popup AND calling view.deselect(). The selection can only
// be "cleared immediately" on that path, so this test drives it through the
// REAL eventDispatcher (not mocked) against the real hook.
//
// The popup-show timer used to clear the isUpToPopup latch 500ms after
// the popup showed, racing the 250ms-deferred trailing click: if the click
// arrived after the timer fired, the latch was already false and the
// trailing click deselected the just-made selection (#7522). The latch is
// now bounded by gestures instead of the timer — set at pointerup, cleared
// by the next pointerdown or consumed by the click — so a delayed trailing
// click still lands on a live latch.
import fs from 'node:fs';
import path from 'node:path';
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import 'foliate-js/view.js';

import { DocumentLoader, type BookDoc } from '@/libs/document';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';

const h = vi.hoisted(() => ({ view: null as FoliateView | null }));

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
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ isFixedLayout: false }) })),
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => 'linux' };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/data/repro-7522-trailing-click.epub');
const available = fs.existsSync(FIXTURE);
const describeIf = available ? describe : describe.skip;

if (!available) {
  console.warn(`[trailing-click] fixture not found, skipping: ${FIXTURE}`);
}

// createDocument() returns a DOMParser document, which has no window, so
// getSelection() is null there. Mount the section's markup in an iframe so
// the hook sees the same shape it sees in production.
const mountSectionDoc = (doc: Document) => {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const liveDoc = iframe.contentDocument!;
  liveDoc.open();
  liveDoc.write(doc.documentElement.outerHTML);
  liveDoc.close();
  // jsdom has no layout, so this window's Range lacks getClientRects — the
  // hook's isPointerInsideSelection calls it at pointerup. Stub a rect
  // around the (0,0) pointer used below so the pointer counts as inside.
  const rect = { left: -10, top: -10, right: 10, bottom: 10, width: 20, height: 20 };
  const winRange = liveDoc.defaultView!.Range.prototype as unknown as {
    getClientRects: () => DOMRectList;
    getBoundingClientRect: () => DOMRect;
  };
  winRange.getClientRects = () => [rect] as unknown as DOMRectList;
  winRange.getBoundingClientRect = () => rect as unknown as DOMRect;
  return liveDoc;
};

// The fixture is a minimal rebuild of the reporter's moby-dick-mo.epub
// holding only chapter_001 (narrated, SMIL word/sentence spans) and
// chapter_003 (unnarrated): section 0 = narrated, section 1 = unnarrated.
// The 9.1 MB narration audio in the original is not needed here.
const NARRATED = 0;
const UNNARRATED = 1;

let book: BookDoc;
let view: FoliateView;

beforeAll(async () => {
  const bytes = fs.readFileSync(FIXTURE);
  const file = new File([bytes], path.basename(FIXTURE), {
    type: 'application/epub+zip',
  });
  book = (await new DocumentLoader(file).open()).book;
  // Bare view: getCFI only reads .book and the range, never the renderer.
  // Give it a renderer stub so view.deselect() (the dismiss path) really
  // clears the section document's selection instead of throwing on a
  // missing renderer.
  const el = document.createElement('foliate-view') as unknown as FoliateView;
  el.book = book;
  view = el;
  h.view = el;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const mousePointer = (x: number, y: number) =>
  ({ pointerType: 'mouse', button: 0, clientX: x, clientY: y }) as PointerEvent;

// A drag selection like a real user makes in chapter 1: the range spans
// several of the word/sentence <span>s the SMIL text targets carry, so the
// range crosses element boundaries instead of sitting inside one text node.
const dragRangeAcrossSpans = (doc: Document): Range => {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let next: Text | null;
  while ((next = walker.nextNode() as Text | null)) {
    if (next.textContent && next.textContent.trim().length > 10) nodes.push(next);
    if (nodes.length >= 4) break;
  }
  if (nodes.length < 3) throw new Error('not enough text nodes for a multi-span drag');
  const range = doc.createRange();
  range.setStart(nodes[0]!, 5);
  range.setEnd(nodes[2]!, Math.min(10, nodes[2]!.textContent!.length));
  return range;
};

const driveMouseSelection = async (doc: Document, index: number) => {
  const range = dragRangeAcrossSpans(doc);
  const expected = range.toString();
  // Wire the bare view's renderer at the mounted doc so deselect() works.
  (view as unknown as { renderer: unknown }).renderer = {
    getContents: () => [{ doc }],
  };

  const setSelection = vi.fn();
  const { result } = renderHook(() =>
    useTextSelector(
      'book-1',
      { top: 0, right: 0, bottom: 0, left: 0 },
      setSelection,
      vi.fn(),
      vi.fn(),
      vi.fn(async (r: Range) => r.toString()),
      vi.fn(),
    ),
  );

  result.current.handlePointerDown(doc, index, mousePointer(0, 0));
  const sel = doc.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  result.current.handleSelectionchange(doc, index);
  await result.current.handlePointerUp(doc, index, mousePointer(0, 0));
  // makeSelection is fired without await inside pointerup; give it a tick.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { result, setSelection, published: setSelection.mock.calls.at(-1)?.[0], expected, doc };
};

// The trailing click, as the reader dispatches it: the real eventDispatcher
// synchronously runs the hook's handleSingleClick (registered on mount).
const dispatchTrailingClick = () =>
  eventDispatcher.dispatchSync('iframe-single-click', { bookKey: 'book-1' });

describeIf('trailing click after a mouse drag selection (#7522)', () => {
  test('narrated chapter: the trailing click does not clear the selection', async () => {
    const doc = mountSectionDoc(await book.sections[NARRATED]!.createDocument());
    const { result, setSelection, published, expected } = await driveMouseSelection(doc, NARRATED);
    expect(setSelection.mock.calls.length, 'setSelection calls').toBeGreaterThan(0);
    expect(published?.text).toBe(expected);
    expect(result.current.isTextSelected.current, 'selected before click').toBe(true);

    const consumed = dispatchTrailingClick();
    expect(consumed, 'trailing click consumed by the latch').toBe(true);
    expect(result.current.isTextSelected.current, 'still selected after click').toBe(true);
    expect(doc.getSelection()?.toString(), 'DOM selection survives the click').toBe(expected);
  });

  test('unnarrated chapter (control): the trailing click does not clear the selection', async () => {
    const doc = mountSectionDoc(await book.sections[UNNARRATED]!.createDocument());
    const { result, setSelection, published, expected } = await driveMouseSelection(
      doc,
      UNNARRATED,
    );
    expect(setSelection.mock.calls.length, 'setSelection calls').toBeGreaterThan(0);
    expect(published?.text).toBe(expected);

    const consumed = dispatchTrailingClick();
    expect(consumed, 'trailing click consumed by the latch').toBe(true);
    expect(result.current.isTextSelected.current, 'still selected after click').toBe(true);
    expect(doc.getSelection()?.toString(), 'DOM selection survives the click').toBe(expected);
  });

  test('a second click after the latch is consumed dismisses (deliberate tap)', async () => {
    const doc = mountSectionDoc(await book.sections[NARRATED]!.createDocument());
    const { result, expected } = await driveMouseSelection(doc, NARRATED);
    expect(dispatchTrailingClick(), 'first click consumed').toBe(true);
    expect(doc.getSelection()?.toString()).toBe(expected);
    // The second click is a deliberate tap: it must dismiss the popup and
    // clear the selection.
    expect(dispatchTrailingClick(), 'second click consumed by dismiss').toBe(true);
    expect(result.current.isTextSelected.current, 'dismissed after second click').toBe(false);
    expect(doc.getSelection()?.toString(), 'DOM selection cleared by second click').toBe('');
  });

  test('popup-show timer no longer clears the latch before a delayed trailing click', async () => {
    const doc = mountSectionDoc(await book.sections[NARRATED]!.createDocument());
    const { result, expected } = await driveMouseSelection(doc, NARRATED);
    expect(result.current.isTextSelected.current, 'selected before popup timer').toBe(true);
    // The Annotator calls handleShowPopup(true) when the popup shows; 500ms
    // later it flips isPopuped — but the isUpToPopup latch now belongs to
    // the gesture, not the timer, so a trailing click deferred past the
    // timer (busy main thread) must still be consumed by the latch.
    result.current.handleShowPopup(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const consumed = dispatchTrailingClick();
    expect(consumed, 'delayed trailing click consumed by the latch').toBe(true);
    expect(result.current.isTextSelected.current, 'still selected after delayed click').toBe(true);
    expect(doc.getSelection()?.toString(), 'DOM selection survives the delayed click').toBe(
      expected,
    );
  });

  test('a stale latch is dropped by the next pointerdown, so the next click dismisses', async () => {
    const doc = mountSectionDoc(await book.sections[NARRATED]!.createDocument());
    const { result } = await driveMouseSelection(doc, NARRATED);
    expect(result.current.isTextSelected.current, 'selected before stale latch').toBe(true);
    // The trailing click never arrived (e.g. suppressed on a link/sup/
    // audio target, where the iframe click handler returns early). The
    // latch from that gesture is stale now; the next gesture's pointerdown
    // must drop it, so the click that follows dismisses instead of being
    // swallowed by the stale latch.
    result.current.handlePointerDown(doc, NARRATED, mousePointer(0, 0));
    expect(dispatchTrailingClick(), 'click after stale latch consumed by dismiss').toBe(true);
    expect(result.current.isTextSelected.current, 'dismissed after click').toBe(false);
    expect(doc.getSelection()?.toString(), 'DOM selection cleared by click').toBe('');
  });
});
