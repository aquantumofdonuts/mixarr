/**
 * DTO Tests
 * 
 * Tests for Data Transfer Object transformations
 */

import { describe, it, expect } from 'vitest';
import { 
  toConnectionDto, 
  toConnectionDtoList 
} from '../../src/dtos/connection.dto.js';
import { 
  toUserDto, 
  toCurrentUserDto 
} from '../../src/dtos/user.dto.js';
import { 
  toNotificationChannelDto 
} from '../../src/dtos/notification.dto.js';
import { 
  toSubscriptionDto 
} from '../../src/dtos/subscription.dto.js';
import type { Connection, User, NotificationChannel, Subscription } from '@prisma/client';

describe('Connection DTO', () => {
  const mockConnection: Connection = {
    id: 1,
    type: 'spotify',
    name: 'My Spotify',
    isActive: true,
    userId: 1,
    config: {
      clientId: 'abc123',
      clientSecret: 'super-secret-key',
      accessToken: 'bearer-token-12345',
      refreshToken: 'refresh-me',
    },
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  it('should mask sensitive fields in config', () => {
    const dto = toConnectionDto(mockConnection);
    
    // clientId is not sensitive (it's the app identifier)
    expect(dto.config.clientId).toBe('abc123');
    // Secrets should be masked
    expect(dto.config.clientSecret).toBe('••••••••');
    expect(dto.config.accessToken).toBe('••••••••');
    expect(dto.config.refreshToken).toBe('••••••••');
  });

  it('should include non-sensitive fields', () => {
    const connectionWithUrl: Connection = {
      ...mockConnection,
      type: 'lidarr',
      config: {
        url: 'http://lidarr:8686',
        apiKey: 'lidarr-api-key-12345',
      },
    };
    
    const dto = toConnectionDto(connectionWithUrl);
    
    expect(dto.config.url).toBe('http://lidarr:8686');
    expect(dto.config.apiKey).toBe('••••••••');
  });

  it('should determine OAuth connection status', () => {
    // With access token = connected
    const connectedDto = toConnectionDto(mockConnection);
    expect(connectedDto.status).toBe('connected');
    
    // Without access token = needs_auth
    const needsAuthConnection: Connection = {
      ...mockConnection,
      config: {
        clientId: 'abc123',
        clientSecret: 'secret',
      },
    };
    const needsAuthDto = toConnectionDto(needsAuthConnection);
    expect(needsAuthDto.status).toBe('needs_auth');
  });

  it('should transform list of connections', () => {
    const connections = [mockConnection, { ...mockConnection, id: 2 }];
    const dtos = toConnectionDtoList(connections);
    
    expect(dtos).toHaveLength(2);
    expect(dtos[0].id).toBe(1);
    expect(dtos[1].id).toBe(2);
  });
});

describe('User DTO', () => {
  const mockUser: User = {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    displayName: 'Test User',
    password: 'hashed-password-should-never-leak',
    role: 'user',
    isActive: true,
    lastLogin: new Date('2024-01-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  it('should never include password in DTO', () => {
    const dto = toUserDto(mockUser);
    
    expect(dto).not.toHaveProperty('password');
    expect(dto.username).toBe('testuser');
    expect(dto.email).toBe('test@example.com');
  });

  it('should create minimal current user DTO', () => {
    const dto = toCurrentUserDto(mockUser);
    
    expect(dto).not.toHaveProperty('password');
    expect(dto).not.toHaveProperty('isActive');
    expect(dto).not.toHaveProperty('lastLogin');
    expect(dto.id).toBe(1);
    expect(dto.username).toBe('testuser');
    expect(dto.role).toBe('user');
  });
});

describe('Notification Channel DTO', () => {
  const mockChannel: NotificationChannel = {
    id: 1,
    userId: 1,
    type: 'discord',
    name: 'My Discord',
    config: {
      webhookUrl: 'https://discord.com/api/webhooks/123456789/abcdefghijk',
      username: 'Mixarr Bot',
    },
    events: ['subscription.completed', 'artist.added'],
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  it('should mask webhook URL', () => {
    const dto = toNotificationChannelDto(mockChannel);
    
    // Should mask the token part but keep the structure visible
    expect(dto.config.webhookUrl).toContain('discord.com');
    expect(dto.config.webhookUrl).toContain('••••');
    // The actual token should be masked
    expect(dto.config.webhookUrl).not.toContain('abcdefghijk');
  });

  it('should preserve non-sensitive fields', () => {
    const dto = toNotificationChannelDto(mockChannel);
    
    expect(dto.config.username).toBe('Mixarr Bot');
    expect(dto.name).toBe('My Discord');
    expect(dto.events).toEqual(['subscription.completed', 'artist.added']);
  });
});

describe('Subscription DTO', () => {
  const mockSubscription: Subscription = {
    id: 1,
    userId: 1,
    name: 'Weekly Charts',
    type: 'lastfm_chart',
    config: {
      chartType: 'artists',
      period: 'week',
      limit: 50,
    },
    resultHandling: 'preview',
    schedule: '0 0 * * 0',
    isActive: true,
    lastRun: new Date('2024-01-01'),
    nextRun: new Date('2024-01-07'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  it('should transform subscription to DTO', () => {
    const dto = toSubscriptionDto(mockSubscription);
    
    expect(dto.id).toBe(1);
    expect(dto.name).toBe('Weekly Charts');
    expect(dto.type).toBe('lastfm_chart');
    expect(dto.config.chartType).toBe('artists');
    expect(dto.config.period).toBe('week');
    expect(dto.config.limit).toBe(50);
  });

  it('should handle null config', () => {
    const subWithNullConfig = {
      ...mockSubscription,
      config: null,
    } as unknown as Subscription;
    
    const dto = toSubscriptionDto(subWithNullConfig);
    
    expect(dto.config).toEqual({});
  });
});
