/**
 * AI Service Tests
 * Tests for the AIService including searchByPrompt functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Store mock functions for later access
const mockOpenAICreate = vi.fn();
const mockAnthropicCreate = vi.fn();

// Mock the prisma client
vi.mock('../../src/lib/db.js', () => ({
  default: {
    aISettings: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock OpenAI - use a proper class mock
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockOpenAICreate,
        },
      };
    },
  };
});

// Mock Anthropic - use a proper class mock
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockAnthropicCreate,
      };
    },
  };
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

    it('should return empty result for empty prompt', async () => {
      const service = new AIService();
      
      const result = await service.searchByPrompt('');
      expect(result).toEqual({ artists: [], providers: [] });
    });

    it('should return empty result for whitespace-only prompt', async () => {
      const service = new AIService();
      
      const result = await service.searchByPrompt('   \n\t  ');
      expect(result).toEqual({ artists: [], providers: [] });
    });

    it('should truncate prompts longer than 500 characters', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: 'test-key',
        openaiEnabled: true,
        openaiStrategy: 'similar',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '["Test Artist"]' } }],
      });

      const service = new AIService();
      const longPrompt = 'a'.repeat(600);
      
      await service.searchByPrompt(longPrompt);
      
      // Verify the API was called with a truncated prompt (500 chars max)
      expect(mockOpenAICreate).toHaveBeenCalled();
      const callArgs = mockOpenAICreate.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      // The prompt should contain the truncated input (500 chars of 'a')
      expect(userMessage.content).toContain('a'.repeat(500));
      expect(userMessage.content).not.toContain('a'.repeat(501));
    });

    it('should return artists from OpenAI when enabled and responding', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: 'test-openai-key',
        openaiEnabled: true,
        openaiStrategy: 'similar',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockOpenAICreate.mockResolvedValue({
        choices: [{
          message: {
            content: '["Nujabes", "J Dilla", "Madlib", "Flying Lotus", "Bonobo"]',
          },
        }],
      });

      const service = new AIService();
      const result = await service.searchByPrompt('chill lo-fi hip hop beats');

      expect(result.artists).toEqual(['Nujabes', 'J Dilla', 'Madlib', 'Flying Lotus', 'Bonobo']);
      expect(result.providers).toEqual(['openai']);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    });

    it('should handle malformed JSON response from OpenAI', async () => {
      vi.mocked(prisma.aISettings.findFirst).mockResolvedValue({
        id: 1,
        openaiApiKey: 'test-openai-key',
        openaiEnabled: true,
        openaiStrategy: 'similar',
        anthropicApiKey: null,
        anthropicEnabled: false,
        anthropicStrategy: 'similar',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockOpenAICreate.mockResolvedValue({
        choices: [{
          message: {
            content: 'Here are some artists: ["Bonobo", "Four Tet", "Caribou"]',
          },
        }],
      });

      const service = new AIService();
      const result = await service.searchByPrompt('electronic ambient music');

      expect(result.artists).toEqual(['Bonobo', 'Four Tet', 'Caribou']);
      expect(result.providers).toEqual(['openai']);
    });
  });
});
