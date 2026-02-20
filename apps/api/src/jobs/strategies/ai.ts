/**
 * AI recommendation subscription strategy.
 *
 * Cross-service strategy: reads the user's library from Spotify or Last.fm,
 * then asks an AI service to suggest similar/new artists.
 *
 * Registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import type {
  SubscriptionStrategy,
  StrategyContext,
  SubscriptionStrategyResult,
  ArtistToAdd,
} from './types.js';
import { AIService } from '../../services/ai.js';
import { SpotifyService } from '../../services/spotify.js';
import { LastfmService } from '../../services/lastfm.js';
import { isSpotifyConfig, isLastFMConfig } from '../../types/connections.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for a result with only artists. */
function artistResult(artists: ArtistToAdd[]): SubscriptionStrategyResult {
  return { artists, albums: [] };
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * ai_recommendation – AI-powered artist discovery.
 *
 * Uses the user's Spotify followed artists or Last.fm top artists as seeds,
 * then asks an AI provider (OpenAI / Anthropic) for recommendations using a
 * configurable strategy (similar, genre_expansion, discovery).
 */
const aiRecommendation: SubscriptionStrategy = {
  async execute(context: StrategyContext): Promise<SubscriptionStrategyResult> {
    const source = context.config.source as 'spotify' | 'lastfm';
    const strategy = context.config.strategy || 'similar';
    const limit = context.config.limit || 20;

    // Collect seed artists from the chosen source
    let sourceArtists: string[] = [];

    if (source === 'spotify') {
      const conn = context.connections.get('spotify');
      if (!conn) throw new Error('No active Spotify connection');
      if (!isSpotifyConfig(conn.config)) {
        throw new Error('Invalid Spotify connection config');
      }
      const spotify = new SpotifyService(conn.config);
      const followed = await spotify.getAllFollowedArtists();
      sourceArtists = followed.slice(0, 20).map(a => a.name);
    } else if (source === 'lastfm') {
      const conn = context.connections.get('lastfm');
      if (!conn) throw new Error('No active Last.fm connection');
      if (!isLastFMConfig(conn.config)) {
        throw new Error('Invalid Last.fm connection config');
      }
      const lastfm = new LastfmService({ apiKey: conn.config.apiKey });
      const top = await lastfm.getTopArtists(20);
      sourceArtists = top.artists.map(a => a.name);
    }

    if (sourceArtists.length === 0) {
      throw new Error(`No artists found in ${source} library to analyze`);
    }

    // Get AI recommendations
    const aiService = new AIService();
    await aiService.loadSettings();

    const recs = await aiService.getRecommendationsWithStrategy(
      sourceArtists,
      strategy,
      limit,
    );

    return artistResult(
      recs.map(r => ({
        name: r.name,
        source: `ai-${source}-${strategy}`,
      })),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('ai_recommendation', aiRecommendation);
