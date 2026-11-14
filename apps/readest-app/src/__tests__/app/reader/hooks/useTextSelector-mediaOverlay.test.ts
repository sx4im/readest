// Runs under the default jsdom environment (like the other iframe-based
// useTextSelector tests): happy-dom leaves a fresh iframe's contentDocument
// null, and the real EPUB loader needs lookupNamespaceURI.
import fs from 'node:fs';
import path from 'node:path';
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// Readest #7522: on Linux (Flatpak), text cannot be selected in books with
// Media Overlays — the selection is cleared immediately and the annotation
// popup never appears, while books without Media Overlays select fine.
//
// The repro file is the IDPF epub3-samples `30/moby-dick-mo` book. Its
// chapter 1 wraps every word and sentence in <span id="c01w…"> /
// <span id="c01s…"> elements (the SMIL text targets), so a selection there
// spans many small elements instead of one text node. This test drives the
// real chapter-1 document through the desktop mouse selection flow
// (pointerdown -> native drag selection -> pointerup) and asserts the
// selection is published and still live afterwards.
//
// The fixture is a ~10 MB binary, so it is not committed. Point the test at
// a local copy to run it:
//
//   curl -sLO https://github.com/IDPF/epub3-samples/releases/download/20230704/moby-dick-mo.epub
//   READEST_MO_EPUB=$PWD/moby-dick-mo.epub pnpm test -- useTextSelector-mediaOverlay
//
// Without it the suite soft-skips, the same way the koplugin Lua specs do
// when their toolchain is absent.

import { unzipSync } from 'fflate';

import { getTextFromRange } from '@/utils/sel';

const FIXTURE =
  process.env['READEST_MO_EPUB'] ??
  path.resolve(__dirname, '../../fixtures/data/moby-dick-mo.epub');

const available = fs.existsSync(FIXTURE);
const describeIf = available ? describe : describe.skip;

if (!available) {
  console.warn(`[media-overlay-selection] fixture not found, skipping: ${FIXTURE}`);
}

// Real spine layout: 0=cover, 1=titlepage, 2=brief-toc, 3=preface,
// 4=introduction, 5=epigraph, 6=chapter_001 — the first narrated chapter.
const CH1 = 6;

const h = vi.hoisted(() => ({
  contents: [] as { doc: Document; index: number }[],
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn((index: number) => `epubcfi(/6/${(index + 1) * 2}!/4/2/1:0)`),
    renderer: {
      containerPosition: 0,
      scrollLocked: false,
      getContents: () => h.contents,
    },
  },
  appService: { isAndroidApp: false, isMobile: false },
  viewSettings: { scrolled: false },
  isFixedLayout: false,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => h.viewSettings,
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ isFixedLayout: h.isFixedLayout }) })),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/bridge', () => ({
  setSelectionSuppressed: vi.fn(async () => {}),
}));
vi.mock('@/app/reader/hooks/useInstantAnnotation', () => ({
  useInstantAnnotation: () => ({
    isInstantAnnotationEnabled: () => false,
    handleInstantAnnotationPointerDown: vi.fn(),
    handleInstantAnnotationPointerMove: vi.fn(),
    handleInstantAnnotationPointerCancel: vi.fn(),
    handleInstantAnnotationPointerUp: vi.fn(),
    reapplyInstantAnnotation: vi.fn(),
    cancelInstantAnnotation: vi.fn(),
  }),
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => 'windows' };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const mousePointer = (x: number, y: number) =>
  ({ pointerType: 'mouse', button: 0, clientX: x, clientY: y }) as PointerEvent;

const setup = () => {
  const setSelection = vi.fn();
  const noop = vi.fn();
  const hook = renderHook(() =>
    useTextSelector(
      'book-1',
      ZERO_INSETS,
      setSelection as never,
      noop,
      noop,
      vi.fn(async (range: Range) => getTextFromRange(range, ['rt'])),
      noop,
    ),
  );
  return { ...hook, setSelection };
};

describeIf('selecting text in a Media Overlays chapter (#7522)', () => {
  let ch1Html: string;

  beforeAll(async () => {
    const bytes = fs.readFileSync(FIXTURE);
    // Read chapter 1 straight out of the EPUB zip: the full DocumentLoader
    // needs jsdom's lookupNamespaceURI, but the hook flow under test only
    // needs the chapter's real markup — the SMIL word/sentence spans.
    const entries = unzipSync(new Uint8Array(bytes));
    const xhtml = new TextDecoder().decode(entries['OPS/chapter_001.xhtml']);
    const parsed = new DOMParser().parseFromString(xhtml, 'text/html');
    // The section document itself is a detached parsed document with no
    // Selection API; the reader shows it inside a page iframe, which has one.
    // Host the same markup in an iframe here so the flow sees a real
    // per-page Document with a live Selection, like the reader does.
    ch1Html = parsed.body.innerHTML;
    expect(ch1Html).toContain('id="c01w00001"');
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    h.contents = [];
  });

  test('a mouse drag across the SMIL word spans publishes the selection', async () => {
    const { result, setSelection } = setup();

    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = ch1Html;
    h.contents = [{ doc, index: CH1 }];
    // happy-dom has no layout: let every range cover the page box, so the
    // pointerup point is inside the selection for isPointerInsideSelection.
    const pageBox = { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 };
    const win = iframe.contentWindow as Window & typeof globalThis;
    win.Range.prototype.getClientRects = () => [pageBox] as unknown as DOMRectList;
    win.Range.prototype.getBoundingClientRect = () => pageBox as DOMRect;

    // The opening line: three per-word spans, then per-sentence spans.
    const firstWord = doc.getElementById('c01w00001')!;
    const thirdWord = doc.getElementById('c01w00003')!;
    const range = doc.createRange();
    range.setStart(firstWord.firstChild!, 0);
    range.setEnd(thirdWord.firstChild!, thirdWord.textContent!.length);

    result.current.handlePointerDown(doc, CH1, mousePointer(5, 5));
    // The browser's native drag selection, as it stands at release.
    const sel = doc.getSelection()!;
    sel.addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
    await result.current.handlePointerUp(doc, CH1, mousePointer(50, 50));

    // The popup's selection is published with the dragged text…
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection.mock.calls[0]![0].text).toContain('Call');
    expect(setSelection.mock.calls[0]![0].text).toContain('Ishmael.');
    // …and the native selection is still live in the page, not cleared.
    expect(sel.rangeCount).toBe(1);
    expect(sel.toString()).toContain('Call');
    expect(sel.toString()).toContain('Ishmael.');
  });

  test('a mouse drag across a whole SMIL sentence span publishes the selection', async () => {
    const { result, setSelection } = setup();

    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = ch1Html;
    h.contents = [{ doc, index: CH1 }];
    const pageBox = { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 };
    const win = iframe.contentWindow as Window & typeof globalThis;
    win.Range.prototype.getClientRects = () => [pageBox] as unknown as DOMRectList;
    win.Range.prototype.getBoundingClientRect = () => pageBox as DOMRect;

    const sentence = doc.getElementById('c01s0002')!;
    const range = doc.createRange();
    range.selectNodeContents(sentence);

    result.current.handlePointerDown(doc, CH1, mousePointer(5, 5));
    const sel = doc.getSelection()!;
    sel.addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
    await result.current.handlePointerUp(doc, CH1, mousePointer(50, 50));

    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection.mock.calls[0]![0].text).toContain('Some years ago');
    expect(sel.rangeCount).toBe(1);
    expect(sel.toString()).toContain('Some years ago');
  });
});
