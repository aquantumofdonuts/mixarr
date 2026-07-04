/**
 * AI Service
 * 
 * Handles AI-based artist recommendations using OpenAI and Anthropic APIs.
 * Ported from v1 routes/routes.py AI functions.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../lib/db.js';
import { AIStrategy } from '@prisma/client';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('AI');

export interface AIRecommendation {
  name: string;
  source: 'openai' | 'anthropic';
  strategy: string;
  sourceArtist?: string;
}

interface AISettings {
  openaiApiKey: string | null;
  openaiEnabled: boolean;
  openaiStrategy: AIStrategy;
  openaiBaseUrl: string | null;
  openaiModel: string | null;
  anthropicApiKey: string | null;
  anthropicEnabled: boolean;
  anthropicStrategy: AIStrategy;
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/**
 * Placeholder API key for OpenAI-compatible endpoints that don't require auth.
 * The OpenAI SDK requires a non-empty apiKey parameter. This placeholder is used
 * when connecting to local services like Ollama. See ISSUES.md TD-006 for potential
 * future cleanup.
 */
const PLACEHOLDER_API_KEY = 'ollama-local-no-key-required';

const STRATEGY_PROMPTS: Record<AIStrategy, string> = {
  similar: 'find 5 similar artists with comparable sound, style, and genre',
  genre_expansion: 'find 5 artists from related genres and subgenres that would appeal to fans',
  discovery: 'find 5 completely different but potentially interesting artists for discovery',
};

export class AIService {
  private settings: AISettings | null = null;
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;

  /**
   * Load or refresh AI settings from database
   */
  async loadSettings(): Promise<AISettings | null> {
    const settings = await prisma.aISettings.findFirst();
    if (!settings) {
      return null;
    }
    
    this.settings = {
      openaiApiKey: settings.openaiApiKey,
      openaiEnabled: settings.openaiEnabled,
      openaiStrategy: settings.openaiStrategy,
      openaiBaseUrl: settings.openaiBaseUrl,
      openaiModel: settings.openaiModel,
      anthropicApiKey: settings.anthropicApiKey,
      anthropicEnabled: settings.anthropicEnabled,
      anthropicStrategy: settings.anthropicStrategy,
    };

    // Initialize clients if enabled
    // For custom base URLs (Ollama, LiteLLM, etc.), API key may not be required
    const hasOpenAIKey = !!this.settings.openaiApiKey;
    const hasCustomBaseUrl = !!this.settings.openaiBaseUrl;
    
    if (this.settings.openaiEnabled && (hasOpenAIKey || hasCustomBaseUrl)) {
      this.openaiClient = new OpenAI({
        apiKey: this.settings.openaiApiKey || PLACEHOLDER_API_KEY,
        ...(this.settings.openaiBaseUrl && { baseURL: this.settings.openaiBaseUrl }),
      });
    }
    
    if (this.settings.anthropicEnabled && this.settings.anthropicApiKey) {
      this.anthropicClient = new Anthropic({ apiKey: this.settings.anthropicApiKey });
    }

    return this.settings;
  }

  /**
   * Get AI recommendations for a list of artists
   */
  async getRecommendations(
    artistNames: string[],
    maxRecommendations: number = 20
  ): Promise<AIRecommendation[]> {
    if (!this.settings) {
      await this.loadSettings();
    }

    if (!this.settings) {
      return [];
    }

    const allRecommendations: AIRecommendation[] = [];

    // Get OpenAI recommendations if enabled
    if (this.settings.openaiEnabled && this.openaiClient) {
      try {
        const openaiRecs = await this.getOpenAIRecommendations(
          artistNames,
          this.settings.openaiStrategy
        );
        allRecommendations.push(...openaiRecs);
      } catch (error) {
        logger.error('OpenAI recommendations failed', { error });
      }
    }

    // Get Anthropic recommendations if enabled
    if (this.settings.anthropicEnabled && this.anthropicClient) {
      try {
        const anthropicRecs = await this.getAnthropicRecommendations(
          artistNames,
          this.settings.anthropicStrategy
        );
        allRecommendations.push(...anthropicRecs);
      } catch (error) {
        logger.error('Anthropic recommendations failed', { error });
      }
    }

    // Deduplicate by artist name (case-insensitive)
    const seen = new Set<string>();
    const uniqueRecs = allRecommendations.filter(rec => {
      const key = rec.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Limit to max recommendations
    return uniqueRecs.slice(0, maxRecommendations);
  }

  /**
   * Get recommendations from OpenAI
   */
  private async getOpenAIRecommendations(
    artistNames: string[],
    strategy: AIStrategy
  ): Promise<AIRecommendation[]> {
    if (!this.openaiClient) return [];

    const strategyPrompt = STRATEGY_PROMPTS[strategy];
    const artistList = artistNames.slice(0, 10).join(', ');

    const prompt = `Based on these artists: ${artistList}

For each artist, ${strategyPrompt}.

Return ONLY a JSON array of artist names, nothing else. Format:
["Artist Name 1", "Artist Name 2", ...]

Return at least 5 unique artists total, maximum 10.`;

    try {
      const model = this.settings?.openaiModel || DEFAULT_OPENAI_MODEL;
      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a music expert that recommends artists. Always respond with valid JSON arrays only.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content || '[]';
      const artists = this.parseArtistList(content);

      return artists.map(name => ({
        name,
        source: 'openai' as const,
        strategy,
        sourceArtist: artistNames[0],
      }));
    } catch (error) {
      logger.error('OpenAI API error', { error });
      return [];
    }
  }

  /**
   * Get recommendations from Anthropic
   */
  private async getAnthropicRecommendations(
    artistNames: string[],
    strategy: AIStrategy
  ): Promise<AIRecommendation[]> {
    if (!this.anthropicClient) return [];

    const strategyPrompt = STRATEGY_PROMPTS[strategy];
    const artistList = artistNames.slice(0, 10).join(', ');

    const prompt = `Based on these artists: ${artistList}

For each artist, ${strategyPrompt}.

Return ONLY a JSON array of artist names, nothing else. Format:
["Artist Name 1", "Artist Name 2", ...]

Return at least 5 unique artists total, maximum 10.`;

    try {
      const response = await this.anthropicClient.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
        system: 'You are a music expert that recommends artists. Always respond with valid JSON arrays only.',
      });

      const textBlock = response.content.find((block: { type: string }) => block.type === 'text');
      const content = textBlock && 'text' in textBlock ? textBlock.text : '[]';
      const artists = this.parseArtistList(content);

      return artists.map(name => ({
        name,
        source: 'anthropic' as const,
        strategy,
        sourceArtist: artistNames[0],
      }));
    } catch (error) {
      logger.error('Anthropic API error', { error });
      return [];
    }
  }

  /**
   * Parse artist list from AI response
   */
  private parseArtistList(content: string): string[] {
    try {
      // Try to extract JSON array from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed.filter(item => typeof item === 'string' && item.trim());
        }
      }
    } catch {
      // If JSON parsing fails, try to extract artist names line by line
      const lines = content.split('\n');
      return lines
        .map(line => line.replace(/^[\d\.\-\*]+\s*/, '').replace(/["']/g, '').trim())
        .filter(line => line.length > 0 && line.length < 100);
    }
    return [];
  }

  /**
   * Search for artists based on a natural language prompt
   * Used by the AI Search feature on the search page
   */
  async searchByPrompt(
    prompt: string,
    limit: number = 20
  ): Promise<{ artists: string[]; providers: ('openai' | 'anthropic')[]; errors?: string[] }> {
    // Input validation: check for empty/whitespace-only prompts
    if (!prompt || !prompt.trim()) {
      return { artists: [], providers: [] };
    }

    // Input validation: limit prompt to 500 characters max
    const trimmedPrompt = prompt.trim().slice(0, 500);

    if (!this.settings) {
      await this.loadSettings();
    }

    if (!this.settings) {
      return { artists: [], providers: [] };
    }

    const allArtists: string[] = [];
    const usedProviders: ('openai' | 'anthropic')[] = [];
    const errors: string[] = [];

    // Build the prompt for natural language search
    const searchPrompt = `Based on this request: "${trimmedPrompt}"

Recommend 15-20 music artists that match this description. Consider genre, mood, era, and style.

Return ONLY a JSON array of artist names, nothing else. Format:
["Artist Name 1", "Artist Name 2", ...]`;

    // Try OpenAI if enabled
    if (this.settings.openaiEnabled && this.openaiClient) {
      try {
        const model = this.settings.openaiModel || DEFAULT_OPENAI_MODEL;
        const response = await this.openaiClient.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are a music expert that recommends artists based on descriptions. Always respond with valid JSON arrays only.',
            },
            { role: 'user', content: searchPrompt },
          ],
          max_tokens: 500,
          temperature: 0.7,
        });

        const content = response.choices[0]?.message?.content || '[]';
        const artists = this.parseArtistList(content);
        allArtists.push(...artists);
        usedProviders.push('openai');
      } catch (error: any) {
        const errorMsg = error?.code === 'EAI_AGAIN' || error?.cause?.code === 'EAI_AGAIN'
          ? 'OpenAI: DNS resolution failed (network issue)'
          : `OpenAI: ${error?.message || 'Unknown error'}`;
        logger.error('AI Search OpenAI error', { error });
        errors.push(errorMsg);
      }
    }

    // Try Anthropic if enabled
    if (this.settings.anthropicEnabled && this.anthropicClient) {
      try {
        const response = await this.anthropicClient.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 500,
          messages: [{ role: 'user', content: searchPrompt }],
          system: 'You are a music expert that recommends artists based on descriptions. Always respond with valid JSON arrays only.',
        });

        const textBlock = response.content.find((block: { type: string }) => block.type === 'text');
        const content = textBlock && 'text' in textBlock ? textBlock.text : '[]';
        const artists = this.parseArtistList(content);
        allArtists.push(...artists);
        usedProviders.push('anthropic');
      } catch (error: any) {
        const errorMsg = error?.code === 'EAI_AGAIN' || error?.cause?.code === 'EAI_AGAIN'
          ? 'Anthropic: DNS resolution failed (network issue)'
          : `Anthropic: ${error?.message || 'Unknown error'}`;
        logger.error('AI Search Anthropic error', { error });
        errors.push(errorMsg);
      }
    }

    // Deduplicate artist names (case-insensitive)
    const seen = new Set<string>();
    const uniqueArtists = allArtists.filter(name => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      artists: uniqueArtists.slice(0, limit),
      providers: usedProviders,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Check if AI is available (at least one provider enabled)
   */
  async isAvailable(): Promise<boolean> {
    if (!this.settings) {
      await this.loadSettings();
    }
    
    if (!this.settings) return false;
    
    // OpenAI is available if enabled AND (has API key OR has custom base URL)
    const openaiAvailable = this.settings.openaiEnabled && 
      (!!this.settings.openaiApiKey || !!this.settings.openaiBaseUrl);
    
    return (
      openaiAvailable ||
      (this.settings.anthropicEnabled && !!this.settings.anthropicApiKey)
    );
  }

  /**
   * Get recommendations with a specific strategy (for subscription use)
   */
  async getRecommendationsWithStrategy(
    artistNames: string[],
    strategy: 'similar' | 'genre_expansion' | 'discovery',
    maxRecommendations: number = 20
  ): Promise<AIRecommendation[]> {
    if (!this.settings) {
      await this.loadSettings();
    }

    if (!this.settings) {
      return [];
    }

    const allRecommendations: AIRecommendation[] = [];

    // Get OpenAI recommendations if enabled
    if (this.settings.openaiEnabled && this.openaiClient) {
      try {
        const openaiRecs = await this.getOpenAIRecommendations(
          artistNames,
          strategy as AIStrategy
        );
        allRecommendations.push(...openaiRecs);
      } catch (error) {
        logger.error('OpenAI recommendations failed', { error });
      }
    }

    // Get Anthropic recommendations if enabled
    if (this.settings.anthropicEnabled && this.anthropicClient) {
      try {
        const anthropicRecs = await this.getAnthropicRecommendations(
          artistNames,
          strategy as AIStrategy
        );
        allRecommendations.push(...anthropicRecs);
      } catch (error) {
        logger.error('Anthropic recommendations failed', { error });
      }
    }

    // Deduplicate by artist name (case-insensitive)
    const seen = new Set<string>();
    const uniqueRecs = allRecommendations.filter(rec => {
      const key = rec.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Limit to max recommendations
    return uniqueRecs.slice(0, maxRecommendations);
  }
}

// Singleton instance
export const aiService = new AIService();
