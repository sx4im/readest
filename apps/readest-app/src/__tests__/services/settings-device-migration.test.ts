// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, type Context } from '@/services/settingsService';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

/**
 * Tests for iOS device-migration device-ID rotation (issue #7558):
 * Apple's device-to-device migration copies settings.json into a fresh
 * app container on the new iPhone, so the persisted sync device IDs
 * would be shared by two physical devices. loadSettings binds the
 * per-device IDs to the app-data container path (which embeds a
 * per-install UUID on iOS): a changed container means the settings
 * were migrated, so fresh IDs are minted.
 */

const disk = vi.hoisted(() => ({
  settings: undefined as Partial<SystemSettings> | undefined,
  save: vi.fn(),
}));
vi.mock('@/services/persistence', () => ({
  safeLoadJSON: async (_fs: unknown, _name: string, _base: string, fallback: unknown) =>
    structuredClone(disk.settings ?? fallback),
  safeSaveJSON: async (_fs: unknown, _name: string, _base: string, settings: SystemSettings) => {
    await disk.save(settings);
    disk.settings = structuredClone(settings);
  },
}));

const OLD_CONTAINER =
  '/var/mobile/Containers/Data/Application/OLD-UUID/Library/Application Support';
const NEW_CONTAINER =
  '/var/mobile/Containers/Data/Application/NEW-UUID/Library/Application Support';
let container = NEW_CONTAINER;

const ctx: Context = {
  fs: {
    getPrefix: async (base: string) => (base === 'Data' ? container : `${container}/Books`),
  } as unknown as FileSystem,
  isMobile: true,
  isEink: false,
  isAppDataSandbox: true,
};

const seedSettings = (overrides: Partial<SystemSettings> = {}): void => {
  disk.settings = {
    ...structuredClone(DEFAULT_SYSTEM_SETTINGS),
    replicaDeviceId: 'replica-old',
    kosync: { ...DEFAULT_SYSTEM_SETTINGS.kosync!, deviceId: 'kosync-old' },
    bookorbit: { ...DEFAULT_SYSTEM_SETTINGS.bookorbit!, deviceId: 'bookorbit-old' },
    webdav: { ...DEFAULT_SYSTEM_SETTINGS.webdav!, deviceId: 'webdav-old' },
    googleDrive: { ...DEFAULT_SYSTEM_SETTINGS.googleDrive!, deviceId: 'gdrive-old' },
    ...overrides,
  };
};

beforeEach(() => {
  localStorage.clear();
  disk.save.mockReset().mockResolvedValue(undefined);
  container = NEW_CONTAINER;
  seedSettings();
});

describe('device migration (issue #7558)', () => {
  it('adopts the current container without rotating IDs on first run', async () => {
    const settings = await loadSettings(ctx);
    expect(settings.kosync.deviceId).toBe('kosync-old');
    expect(settings.bookorbit.deviceId).toBe('bookorbit-old');
    expect(settings.replicaDeviceId).toBe('replica-old');
    expect(settings.deviceContainerId).toBe(NEW_CONTAINER);
    expect(disk.settings?.deviceContainerId).toBe(NEW_CONTAINER);
  });

  it('mints fresh device IDs when the stored container differs', async () => {
    seedSettings({ deviceContainerId: OLD_CONTAINER });
    const settings = await loadSettings(ctx);
    expect(settings.kosync.deviceId).not.toBe('kosync-old');
    expect(settings.bookorbit.deviceId).not.toBe('bookorbit-old');
    expect(settings.replicaDeviceId).not.toBe('replica-old');
    expect(settings.kosync.deviceId).not.toBe(settings.bookorbit.deviceId);
    expect(settings.kosync.deviceId).not.toBe(settings.replicaDeviceId);
    expect(settings.deviceContainerId).toBe(NEW_CONTAINER);
    expect(disk.settings?.deviceContainerId).toBe(NEW_CONTAINER);
    expect(disk.settings?.kosync?.deviceId).toBe(settings.kosync.deviceId);
  });

  it('rotates file-sync provider IDs too, but only when present', async () => {
    seedSettings({
      deviceContainerId: OLD_CONTAINER,
      s3: { ...DEFAULT_SYSTEM_SETTINGS.s3!, deviceId: 's3-old' },
      onedrive: { ...DEFAULT_SYSTEM_SETTINGS.onedrive! },
      icloud: { ...DEFAULT_SYSTEM_SETTINGS.icloud!, deviceId: 'icloud-old' },
    });
    const settings = await loadSettings(ctx);
    expect(settings.webdav.deviceId).not.toBe('webdav-old');
    expect(settings.googleDrive.deviceId).not.toBe('gdrive-old');
    expect(settings.s3.deviceId).not.toBe('s3-old');
    expect(settings.icloud.deviceId).not.toBe('icloud-old');
    // onedrive ships no deviceId (default is empty): rotation must not mint one.
    expect(settings.onedrive.deviceId).toBeFalsy();
  });

  it('keeps IDs when the stored container matches', async () => {
    seedSettings({ deviceContainerId: NEW_CONTAINER });
    const settings = await loadSettings(ctx);
    expect(settings.kosync.deviceId).toBe('kosync-old');
    expect(settings.bookorbit.deviceId).toBe('bookorbit-old');
    expect(settings.replicaDeviceId).toBe('replica-old');
    expect(settings.webdav.deviceId).toBe('webdav-old');
  });

  it('does not rotate or adopt on non-sandboxed platforms', async () => {
    seedSettings({ deviceContainerId: OLD_CONTAINER });
    const desktopCtx: Context = { ...ctx, isAppDataSandbox: false };
    const settings = await loadSettings(desktopCtx);
    expect(settings.kosync.deviceId).toBe('kosync-old');
    expect(settings.bookorbit.deviceId).toBe('bookorbit-old');
    expect(settings.replicaDeviceId).toBe('replica-old');
    expect(settings.deviceContainerId).toBe(OLD_CONTAINER);
  });

  it('keeps the rotated IDs stable on the next load', async () => {
    seedSettings({ deviceContainerId: OLD_CONTAINER });
    const first = await loadSettings(ctx);
    const rotated = {
      kosync: first.kosync.deviceId,
      bookorbit: first.bookorbit.deviceId,
      replica: first.replicaDeviceId,
    };
    const second = await loadSettings(ctx);
    expect(second.kosync.deviceId).toBe(rotated.kosync);
    expect(second.bookorbit.deviceId).toBe(rotated.bookorbit);
    expect(second.replicaDeviceId).toBe(rotated.replica);
  });
});
