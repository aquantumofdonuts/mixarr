import { z } from 'zod';
import type { LidarrConnectionConfig } from '../types/connections.js';
import type { LidarrService } from '../services/lidarr.js';
import { DecisionError } from './decision.js';

export const addOptionsSchema = z.object({
  qualityProfileId: z.number().int().positive().optional(),
  metadataProfileId: z.number().int().positive().optional(),
  rootFolderPath: z.string().min(1).max(1000).optional(),
  monitorOption: z.enum(['all', 'future', 'missing', 'existing', 'first', 'latest', 'none']).optional(),
  monitorNewItems: z.enum(['all', 'none', 'new']).optional(),
  searchOnAdd: z.boolean().optional(),
});
export type AddOptions = z.infer<typeof addOptionsSchema>;

/** Saved defaults are trusted connection settings; explicit choices must still exist in this owner's Lidarr. */
export async function effectiveAddOptions(lidarr: LidarrService, config: Partial<LidarrConnectionConfig>, input: AddOptions, signal?: AbortSignal) {
  const [quality, metadata, roots] = await Promise.all([
    input.qualityProfileId !== undefined || !config.qualityProfileId ? lidarr.getQualityProfiles(signal) : Promise.resolve(null),
    input.metadataProfileId !== undefined || !config.metadataProfileId ? lidarr.getMetadataProfiles(signal) : Promise.resolve(null),
    input.rootFolderPath !== undefined || !config.rootFolderPath ? lidarr.getRootFolders(signal) : Promise.resolve(null),
  ]);
  signal?.throwIfAborted();
  const qualityProfileId = input.qualityProfileId ?? config.qualityProfileId ?? quality?.[0]?.id;
  const metadataProfileId = input.metadataProfileId ?? config.metadataProfileId ?? metadata?.[0]?.id;
  const rootFolderPath = input.rootFolderPath ?? config.rootFolderPath ?? roots?.[0]?.path;
  if (!qualityProfileId || !metadataProfileId || !rootFolderPath) throw new DecisionError(422, 'CONFIGURATION_REQUIRED', 'Configure Lidarr profiles and root folder');
  if ((quality && !quality.some(p => p.id === qualityProfileId)) || (metadata && !metadata.some(p => p.id === metadataProfileId)) || (roots && !roots.some(p => p.path === rootFolderPath))) {
    throw new DecisionError(400, 'INVALID_OPTIONS', 'Choose an available Lidarr profile and root folder');
  }
  return { qualityProfileId, metadataProfileId, rootFolderPath, monitorOption: input.monitorOption ?? config.monitorOption ?? 'all',
    monitorNewItems: input.monitorNewItems ?? config.monitorNewItems ?? 'all', searchOnAdd: input.searchOnAdd ?? config.searchOnAdd ?? true };
}
