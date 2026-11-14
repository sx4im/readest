// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The <Dialog> chassis (overlay, focus trap, swipe-to-dismiss) is covered by
// its own tests; here it is just a passthrough so the test stays on this
// dialog's own state logic.
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: vi.fn(),
}));
// Return the key itself so labels are deterministic without i18n init.
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import ImportFromFolderDialog from '@/app/library/components/ImportFromFolderDialog';

const readInPlaceToggle = () =>
  screen.getByRole('checkbox', { name: /Read books in place/ }) as HTMLInputElement;

const renderDialog = (props: {
  initialDirectory?: string;
  initialReadInPlace?: boolean;
  isRegisteredExternalRoot?: (directory: string) => boolean;
  onPickDirectory?: () => Promise<string | undefined>;
  onConfirm?: (result: { directory: string; readInPlace: boolean }) => void;
}) => {
  const onPickDirectory = props.onPickDirectory ?? vi.fn().mockResolvedValue(undefined);
  const onConfirm = props.onConfirm ?? vi.fn();
  render(
    <ImportFromFolderDialog
      initialDirectory={props.initialDirectory ?? '/books'}
      initialReadInPlace={props.initialReadInPlace ?? false}
      isRegisteredExternalRoot={props.isRegisteredExternalRoot ?? (() => false)}
      onPickDirectory={onPickDirectory}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return { onPickDirectory, onConfirm };
};

describe('ImportFromFolderDialog read-in-place choice', () => {
  afterEach(cleanup);

  // #7519: enable in-place -> pick an unregistered folder -> confirm must
  // still import in place.
  it('keeps an explicit in-place choice after picking an unregistered folder', async () => {
    const onPickDirectory = vi.fn().mockResolvedValue('/books/new');
    const onConfirm = vi.fn();
    renderDialog({ initialReadInPlace: false, onPickDirectory, onConfirm });

    // Enable "Read books in place" before choosing the folder.
    fireEvent.click(readInPlaceToggle());
    expect(readInPlaceToggle().checked).toBe(true);

    // Pick a folder that is NOT registered as an external library.
    fireEvent.click(screen.getByRole('button', { name: 'Choose a folder' }));
    await waitFor(() => expect(onPickDirectory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readInPlaceToggle().checked).toBe(true));

    // Confirming reports the in-place choice for the picked folder.
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ directory: '/books/new', readInPlace: true }),
    );
  });

  // #5680: the box must still snap to a picked folder's real state when
  // that folder IS registered — unchecking a registered folder, then
  // picking another registered folder, shows it ON again.
  it('snaps back to ON when the picked folder is already registered', async () => {
    const onPickDirectory = vi.fn().mockResolvedValue('/registered2');
    renderDialog({
      initialDirectory: '/registered',
      initialReadInPlace: false,
      isRegisteredExternalRoot: (dir) => dir === '/registered' || dir === '/registered2',
      onPickDirectory,
    });

    // Registered folder: the box starts ON from its real state.
    expect(readInPlaceToggle().checked).toBe(true);
    // Uncheck it (explicit choice: off for this folder).
    fireEvent.click(readInPlaceToggle());
    expect(readInPlaceToggle().checked).toBe(false);

    // Pick another registered folder: the box snaps to that folder's real state.
    fireEvent.click(screen.getByRole('button', { name: 'Choose a folder' }));
    await waitFor(() => expect(onPickDirectory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readInPlaceToggle().checked).toBe(true));
  });

  // Symmetric to #7519: an explicit OFF choice also survives picking an
  // unregistered folder instead of snapping back to the persisted preference.
  it('keeps an explicit off choice after picking an unregistered folder', async () => {
    const onPickDirectory = vi.fn().mockResolvedValue('/books/other');
    const onConfirm = vi.fn();
    renderDialog({ initialReadInPlace: true, onPickDirectory, onConfirm });

    // Persisted preference had in-place ON; the user turns it off here.
    expect(readInPlaceToggle().checked).toBe(true);
    fireEvent.click(readInPlaceToggle());
    expect(readInPlaceToggle().checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Choose a folder' }));
    await waitFor(() => expect(onPickDirectory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readInPlaceToggle().checked).toBe(false));

    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ directory: '/books/other', readInPlace: false }),
    );
  });
});
