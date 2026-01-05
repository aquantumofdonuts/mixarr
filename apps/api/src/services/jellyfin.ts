/**
 * Jellyfin Service
 * 
 * Handles interactions with Jellyfin API for listening history.
 */

import { rateLimit } from './rate-limiter.js';

export interface JellyfinConfig {
  jellyfinUrl: string;
  jellyfinApiKey: string;
  jellyfinUserId?: string;
  jellyfinLibraryId?: string;
}

export interface JellyfinUser {
  userId: string;
  username: string;
  isAdmin: boolean;
}

export interface JellyfinLibrary {
  libraryId: string;
  name: string;
  type: string;
}

export interface JellyfinArtist {
  name: string;
  playCount: number;
  lastPlayed?: Date;
  thumb?: string;
}

export class JellyfinService {
  constructor() {}
}
