/**
 * SubscriptionController Tests
 * 
 * Tests for the subscription controller.
 * Tests cover:
 * - HTTP status codes (200, 201, 204, 404)
 * - Delegation to SubscriptionService
 * - Error handling (NotFoundError → 404, other errors → next())
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the subscription service
vi.mock('../../src/services/subscriptions.service.js', () => ({
  subscriptionService: {
    findAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  NotFoundError: class NotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
}));

// Import after mocks are set up
import { SubscriptionController, subscriptionController } from '../../src/controllers/subscriptions.controller.js';
import { subscriptionService, NotFoundError } from '../../src/services/subscriptions.service.js';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    controller = new SubscriptionController();
    
    jsonMock = vi.fn();
    sendMock = vi.fn();
    statusMock = vi.fn().mockReturnThis();
    
    mockReq = {
      user: { id: 1, username: 'testuser', role: 'user' } as any,
      params: {},
      body: {},
    };
    
    mockRes = {
      json: jsonMock as any,
      status: statusMock as any,
      send: sendMock as any,
    };
    
    mockNext = vi.fn();
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('should return 200 with subscriptions', async () => {
      const mockSubscriptions = [
        { id: 1, name: 'Sub 1' },
        { id: 2, name: 'Sub 2' },
      ];
      vi.mocked(subscriptionService.findAll).mockResolvedValue(mockSubscriptions as any);

      await controller.list(mockReq as Request, mockRes as Response, mockNext);

      expect(subscriptionService.findAll).toHaveBeenCalledWith(1);
      expect(jsonMock).toHaveBeenCalledWith({ subscriptions: mockSubscriptions });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with error on service failure', async () => {
      const error = new Error('Database error');
      vi.mocked(subscriptionService.findAll).mockRejectedValue(error);

      await controller.list(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(jsonMock).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return 200 with subscription when found', async () => {
      const mockSubscription = { id: 1, name: 'Test Sub' };
      mockReq.params = { id: '1' };
      vi.mocked(subscriptionService.findById).mockResolvedValue(mockSubscription as any);

      await controller.getById(mockReq as Request, mockRes as Response, mockNext);

      expect(subscriptionService.findById).toHaveBeenCalledWith(1, 1);
      expect(jsonMock).toHaveBeenCalledWith({ subscription: mockSubscription });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 when NotFoundError is thrown', async () => {
      mockReq.params = { id: '999' };
      vi.mocked(subscriptionService.findById).mockRejectedValue(new NotFoundError('Subscription not found'));

      await controller.getById(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Subscription not found' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with error on other service failures', async () => {
      mockReq.params = { id: '1' };
      const error = new Error('Database error');
      vi.mocked(subscriptionService.findById).mockRejectedValue(error);

      await controller.getById(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should return 400 for invalid ID parameter', async () => {
      mockReq.params = { id: 'invalid' };

      await controller.getById(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid subscription ID' });
      expect(subscriptionService.findById).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should return 201 with created subscription', async () => {
      const input = { name: 'New Sub', type: 'lastfm_chart' };
      const created = { id: 1, ...input };
      mockReq.body = input;
      vi.mocked(subscriptionService.create).mockResolvedValue(created as any);

      await controller.create(mockReq as Request, mockRes as Response, mockNext);

      expect(subscriptionService.create).toHaveBeenCalledWith(1, input);
      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith({ subscription: created });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with error on service failure', async () => {
      const error = new Error('Database error');
      mockReq.body = { name: 'New Sub', type: 'lastfm_chart' };
      vi.mocked(subscriptionService.create).mockRejectedValue(error);

      await controller.create(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });
  });

  describe('update', () => {
    it('should return 200 with updated subscription', async () => {
      const input = { name: 'Updated Sub' };
      const updated = { id: 1, ...input };
      mockReq.params = { id: '1' };
      mockReq.body = input;
      vi.mocked(subscriptionService.update).mockResolvedValue(updated as any);

      await controller.update(mockReq as Request, mockRes as Response, mockNext);

      expect(subscriptionService.update).toHaveBeenCalledWith(1, 1, input);
      expect(jsonMock).toHaveBeenCalledWith({ subscription: updated });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 when NotFoundError is thrown', async () => {
      mockReq.params = { id: '999' };
      mockReq.body = { name: 'Updated Sub' };
      vi.mocked(subscriptionService.update).mockRejectedValue(new NotFoundError('Subscription not found'));

      await controller.update(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Subscription not found' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with error on other service failures', async () => {
      mockReq.params = { id: '1' };
      mockReq.body = { name: 'Updated Sub' };
      const error = new Error('Database error');
      vi.mocked(subscriptionService.update).mockRejectedValue(error);

      await controller.update(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should return 400 for invalid ID parameter', async () => {
      mockReq.params = { id: 'invalid' };
      mockReq.body = { name: 'Updated Sub' };

      await controller.update(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid subscription ID' });
      expect(subscriptionService.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should return 204 on successful deletion', async () => {
      mockReq.params = { id: '1' };
      vi.mocked(subscriptionService.delete).mockResolvedValue(undefined);

      await controller.delete(mockReq as Request, mockRes as Response, mockNext);

      expect(subscriptionService.delete).toHaveBeenCalledWith(1, 1);
      expect(statusMock).toHaveBeenCalledWith(204);
      expect(sendMock).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 when NotFoundError is thrown', async () => {
      mockReq.params = { id: '999' };
      vi.mocked(subscriptionService.delete).mockRejectedValue(new NotFoundError('Subscription not found'));

      await controller.delete(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Subscription not found' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with error on other service failures', async () => {
      mockReq.params = { id: '1' };
      const error = new Error('Database error');
      vi.mocked(subscriptionService.delete).mockRejectedValue(error);

      await controller.delete(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should return 400 for invalid ID parameter', async () => {
      mockReq.params = { id: 'invalid' };

      await controller.delete(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid subscription ID' });
      expect(subscriptionService.delete).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should return 200 with job ID on successful execution', async () => {
      mockReq.params = { id: '1' };
      const result = { jobId: 'job-123' };
      vi.mocked(subscriptionService.execute).mockResolvedValue(result);

      await controller.execute(mockReq as Request, mockRes as Response, mockNext);

      expect(subscriptionService.execute).toHaveBeenCalledWith(1, 1);
      expect(jsonMock).toHaveBeenCalledWith(result);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 404 when NotFoundError is thrown', async () => {
      mockReq.params = { id: '999' };
      vi.mocked(subscriptionService.execute).mockRejectedValue(new NotFoundError('Subscription not found'));

      await controller.execute(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Subscription not found' });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next with error on other service failures', async () => {
      mockReq.params = { id: '1' };
      const error = new Error('Queue error');
      vi.mocked(subscriptionService.execute).mockRejectedValue(error);

      await controller.execute(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
    });

    it('should return 400 for invalid ID parameter', async () => {
      mockReq.params = { id: 'invalid' };

      await controller.execute(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Invalid subscription ID' });
      expect(subscriptionService.execute).not.toHaveBeenCalled();
    });
  });

  describe('singleton export', () => {
    it('should export a singleton instance', () => {
      expect(subscriptionController).toBeInstanceOf(SubscriptionController);
    });
  });
});
