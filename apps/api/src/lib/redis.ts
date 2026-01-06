import Redis from 'ioredis';
import { createLogger } from './logger.js';

const logger = createLogger('Redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis.default(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const createRedisConnection = () => new Redis.default(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('error', (err: Error) => {
  logger.error('Redis connection error', { error: err });
});

redis.on('connect', () => {
  logger.info('Connected to Redis');
});
