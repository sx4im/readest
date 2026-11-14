// Whether any open section document of this view currently holds a live
// (non-collapsed) text selection. A remote progress pull that jumps the
// view re-renders the section and clears such a selection (#7522), so pull
// sites check this before applying a remote position to the live view.
// The view shape is structural: section documents may still be loading.
export const hasLiveTextSelection = (
  view?: { renderer?: { getContents?: () => { doc?: Document | null }[] } } | null,
): boolean => {
  const contents = view?.renderer?.getContents?.() ?? [];
  return contents.some(({ doc }) => {
    const selection = doc?.getSelection?.();
    return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
  });
};
