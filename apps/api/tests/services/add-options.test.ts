import { describe, expect, it, vi } from 'vitest';
import { addOptionsSchema, effectiveAddOptions } from '../../src/lib/add-options.js';
import type { LidarrService } from '../../src/services/lidarr.js';
const provider = () => ({ getQualityProfiles: vi.fn().mockResolvedValue([{ id: 2 }]), getMetadataProfiles: vi.fn().mockResolvedValue([{ id: 3 }]), getRootFolders: vi.fn().mockResolvedValue([{ path: '/archive' }]) });
const defaults = { qualityProfileId: 1, metadataProfileId: 1, rootFolderPath: '/music', searchOnAdd: true };
describe('effective acquisition options', () => {
  it('validates explicit choices against the owner provider and preserves false in one operation budget', async () => {
    const lidarr = provider(), signal = new AbortController().signal;
    const options = await effectiveAddOptions(lidarr as unknown as LidarrService, defaults, { qualityProfileId: 2, metadataProfileId: 3, rootFolderPath: '/archive', searchOnAdd: false, monitorOption: 'future', monitorNewItems: 'none' }, signal);
    expect(options).toEqual({ qualityProfileId: 2, metadataProfileId: 3, rootFolderPath: '/archive', searchOnAdd: false, monitorOption: 'future', monitorNewItems: 'none' });
    Object.values(lidarr).forEach(read => expect(read).toHaveBeenCalledWith(signal));
  });
  it.each([{ qualityProfileId: 99 }, { metadataProfileId: 99 }, { rootFolderPath: '/arbitrary' }])('rejects an unavailable explicit choice', async options => {
    const lidarr = provider();
    await expect(effectiveAddOptions(lidarr as unknown as LidarrService, defaults, options)).rejects.toMatchObject({ status: 400, code: 'INVALID_OPTIONS' });
  });
  it('does not turn an aborted option lookup into a successful acquisition configuration', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(effectiveAddOptions(provider() as unknown as LidarrService, defaults, { qualityProfileId: 2 }, controller.signal)).rejects.toThrow();
  });
  it.each([{ qualityProfileId: 0 }, { metadataProfileId: '2' }, { monitorOption: 'guess' }, { monitorNewItems: 'guess' }, { searchOnAdd: 'false' }])('rejects malformed boundary options', options => {
    expect(addOptionsSchema.safeParse(options).success).toBe(false);
  });
});
