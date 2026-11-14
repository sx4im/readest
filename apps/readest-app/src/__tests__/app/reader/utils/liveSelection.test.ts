// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { hasLiveTextSelection } from '@/app/reader/utils/liveSelection';

// The view a sync pull is about to yank: a non-collapsed selection in any
// open section document means the user is mid-selection.
const viewWith = (docs: (Document | null | undefined)[]) => ({
  renderer: { getContents: () => docs.map((doc, index) => ({ doc, index })) },
});

const selectIn = (doc: Document, collapsed = false) => {
  const node = doc.createTextNode('Call me Ishmael.');
  doc.body.appendChild(node);
  const range = doc.createRange();
  range.setStart(node, 0);
  if (collapsed) range.collapse(true);
  else range.setEnd(node, 4);
  doc.getSelection()!.addRange(range);
};

describe('hasLiveTextSelection', () => {
  it('is false without a view', () => {
    expect(hasLiveTextSelection(null)).toBe(false);
    expect(hasLiveTextSelection(undefined)).toBe(false);
  });

  it('is false when no section document holds a selection', () => {
    expect(hasLiveTextSelection(viewWith([document]) as never)).toBe(false);
  });

  it('is false for a collapsed caret (no text selected)', () => {
    selectIn(document, true);
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(hasLiveTextSelection(viewWith([document]) as never)).toBe(false);
    document.getSelection()?.removeAllRanges();
  });

  it('is true for a live selection in a section document', () => {
    selectIn(document);
    expect(document.getSelection()?.isCollapsed).toBe(false);
    expect(hasLiveTextSelection(viewWith([document]) as never)).toBe(true);
    document.getSelection()?.removeAllRanges();
  });

  it('ignores section documents that are not loaded yet', () => {
    selectIn(document);
    expect(hasLiveTextSelection(viewWith([undefined, document]) as never)).toBe(true);
    document.getSelection()?.removeAllRanges();
    expect(hasLiveTextSelection(viewWith([undefined, null]) as never)).toBe(false);
  });
});
