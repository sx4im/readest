// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKORBIT_SETTINGS,
  DEFAULT_KOSYNC_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  SETTINGS_FILENAME,
  SYSTEM_SETTINGS_VERSION,
} from '@/services/constants';
import { loadSettings, type Context } from '@/services/settingsService';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';

// iOS device migration copies settings.json verbatim into the new iPhone's
// app container, so the new device inherits the old device's sync identity
// (#7558). The books dir lives under the per-install app container, so a
// stored books dir that no longer matches the current prefix means these
// settings were carried into a different container.
const OLD_BOOKS_DIR =
  '/var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Library/Application Support/Readest/Data/Books';
const NEW_BOOKS_DIR =
  '/var/mobile/Containers/Data/Application/22222222-2222-4222-8222-222222222222/Library/Application Support/Readest/Data/Books';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const makeFs = (booksPrefix: string) => {
  const files = new Map<string, string>();
  const writes: string[] = [];
  const fs = {
    readFile: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    },
    writeFile: async (path: string, _base: unknown, content: string) => {
      if (path === SETTINGS_FILENAME) writes.push(content);
      files.set(path, content);
    },
    getPrefix: async () => booksPrefix,
  } as unknown as FileSystem;
  return { fs, files, writes };
};

const seedSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    ...DEFAULT_SYSTEM_SETTINGS,
    version: SYSTEM_SETTINGS_VERSION,
    localBooksDir: OLD_BOOKS_DIR,
    kosync: { ...DEFAULT_KOSYNC_SETTINGS, deviceId: 'old-kosync-id', deviceName: 'iPhone A' },
    bookorbit: {
      ...DEFAULT_BOOKORBIT_SETTINGS,
      deviceId: 'old-bookorbit-id',
      deviceName: 'iPhone A',
    },
    replicaDeviceId: 'old-replica-id',
    ...overrides,
  }) as SystemSettings;

const makeCtx = (fs: FileSystem): Context => ({
  fs,
  isMobile: true,
  isDesktopApp: false,
  isEink: false,
  isAppDataSandbox: true,
});

const lastWritten = (writes: string[]): SystemSettings =>
  JSON.parse(writes.at(-1)!) as SystemSettings;

beforeEach(() => {
  localStorage.clear();
});

describe('loadSettings device migration (#7558)', () => {
  it('mints fresh per-device ids when the stored books dir is from another container', async () => {
    const { fs, files, writes } = makeFs(NEW_BOOKS_DIR);
    files.set(SETTINGS_FILENAME, JSON.stringify(seedSettings()));

    const settings = await loadSettings(makeCtx(fs));

    expect(settings.kosync.deviceId).not.toBe('old-kosync-id');
    expect(settings.kosync.deviceId).toMatch(UUID_RE);
    expect(settings.bookorbit.deviceId).not.toBe('old-bookorbit-id');
    expect(settings.bookorbit.deviceId).toMatch(UUID_RE);
    expect(settings.replicaDeviceId).not.toBe('old-replica-id');
    expect(settings.replicaDeviceId).toMatch(UUID_RE);
    expect(settings.localBooksDir).toBe(NEW_BOOKS_DIR);
    // The rotated ids are persisted, not just held in memory.
    const written = lastWritten(writes);
    expect(written.kosync.deviceId).toBe(settings.kosync.deviceId);
    expect(written.bookorbit.deviceId).toBe(settings.bookorbit.deviceId);
    expect(written.replicaDeviceId).toBe(settings.replicaDeviceId);
    expect(written.localBooksDir).toBe(NEW_BOOKS_DIR);
  });

  it('keeps the device ids when the books dir is unchanged', async () => {
    const { fs, files } = makeFs(OLD_BOOKS_DIR);
    files.set(SETTINGS_FILENAME, JSON.stringify(seedSettings()));

    const settings = await loadSettings(makeCtx(fs));

    expect(settings.kosync.deviceId).toBe('old-kosync-id');
    expect(settings.bookorbit.deviceId).toBe('old-bookorbit-id');
    expect(settings.replicaDeviceId).toBe('old-replica-id');
  });

  it('keeps the device ids when the stored books dir is missing', async () => {
    const { fs, files } = makeFs(NEW_BOOKS_DIR);
    const seeded = seedSettings();
    delete (seeded as Partial<SystemSettings>).localBooksDir;
    files.set(SETTINGS_FILENAME, JSON.stringify(seeded));

    const settings = await loadSettings(makeCtx(fs));

    expect(settings.kosync.deviceId).toBe('old-kosync-id');
    expect(settings.bookorbit.deviceId).toBe('old-bookorbit-id');
    expect(settings.replicaDeviceId).toBe('old-replica-id');
  });

  it('still mints missing ids on a fresh install', async () => {
    const { fs } = makeFs(NEW_BOOKS_DIR);

    const settings = await loadSettings(makeCtx(fs));

    expect(settings.kosync.deviceId).toMatch(UUID_RE);
    expect(settings.bookorbit.deviceId).toMatch(UUID_RE);
    expect(settings.replicaDeviceId).toMatch(UUID_RE);
  });
});
