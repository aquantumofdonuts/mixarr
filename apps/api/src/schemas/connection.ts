import { z } from 'zod';

// Valid connection types
export const connectionTypes = [
  'lidarr',
  'spotify',
  'lastfm',
  'tautulli',
  'deezer',
  'tidal',
  'listenbrainz',
  'discogs',
  'jellyfin',
] as const;

export type ConnectionType = (typeof connectionTypes)[number];

// Config schemas for each connection type (for reference/documentation)
export const lidarrConfigSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
});

export const lastfmConfigSchema = z.object({
  apiKey: z.string(),
});

export const tautulliConfigSchema = z.object({
  tautulliUrl: z.string().url(),
  tautulliApiKey: z.string(),
  plexLibraryId: z.number().int().optional(),
  plexUserId: z.number().int().optional(),
});

export const jellyfinConfigSchema = z.object({
  jellyfinUrl: z.string().url(),
  jellyfinApiKey: z.string(),
  jellyfinUserId: z.string().optional(),
  jellyfinLibraryId: z.string().optional(),
});

export const listenbrainzConfigSchema = z.object({
  username: z.string(),
  token: z.string().optional(),
});

// Schema for POST /connections
export const createConnectionSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(connectionTypes),
  isActive: z.boolean().default(true),
  config: z.record(z.unknown()),
});

// Schema for PUT /connections/:id
export const updateConnectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

// Schema for POST /connections/test
export const testConnectionSchema = z.object({
  type: z.enum(connectionTypes),
  config: z.record(z.unknown()),
});

// Export inferred types
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type TestConnectionInput = z.infer<typeof testConnectionSchema>;
