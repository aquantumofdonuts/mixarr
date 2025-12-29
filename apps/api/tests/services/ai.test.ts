/**
 * AI Service Tests
 * Tests for the AIService including searchByPrompt functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client
vi.mock('../../src/lib/db.js', () => ({
  default: {
    aISettings: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock OpenAI - use a class-style mock
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }));
  return { default: MockOpenAI };
});

// Mock Anthropic - use a class-style mock
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  }));
  return { default: MockAnthropic };
});

import { AIService } from '../../src/services/ai.js';
import prisma from '../../src/lib/db.js';

describe('AIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchByPrompt', () => {
    it('should return empty array when no AI providers configured', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue(null);
      
      const service = new AIService();
      const result = await service.searchByPrompt('chill lo-fi beats');
      
      expect(result).toEqual({ artists: [], providers: [] });
    });

    it('should parse artist names from AI response', async () => {
      const service = new AIService();
      
      // Test parseArtistList directly - it's now public for testability
      const parsed = service.parseArtistList('["Nujabes", "J Dilla", "Madlib"]');
      expect(parsed).toEqual(['Nujabes', 'J Dilla', 'Madlib']);
    });

    it('should parse artist list from malformed JSON with extra text', async () => {
      const service = new AIService();
      
      // Test parsing when AI returns extra text around JSON
      const parsed = service.parseArtistList('Here are some artists: ["Bonobo", "Four Tet", "Caribou"]');
      expect(parsed).toEqual(['Bonobo', 'Four Tet', 'Caribou']);
    });
  });
});
