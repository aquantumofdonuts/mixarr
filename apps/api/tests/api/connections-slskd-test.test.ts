import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { connection, testConnection, configure } = vi.hoisted(() => ({
  connection: { findUnique: vi.fn(), update: vi.fn() }, testConnection: vi.fn(), configure: vi.fn(),
}));
vi.mock('../../src/lib/db.js', () => ({ default: { connection } }));
vi.mock('../../src/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: () => void) => {
  req.user = { id: 1, role: 'user' }; next();
} }));
vi.mock('../../src/services/slskd.js', () => ({ SlskdService: class {
  constructor(config: unknown) { configure(config); }
  testConnection = testConnection;
} }));

import { connectionsRouter } from '../../src/routes/connections.js';
const app = express();
app.use(express.json());
app.use('/api/connections', connectionsRouter);

beforeEach(() => {
  vi.clearAllMocks();
  connection.findUnique.mockResolvedValue({ id: 7, userId: 1, type: 'slskd', config: { url: 'http://slskd:5030', apiKey: 'synthetic-key' } });
  connection.update.mockResolvedValue({});
});
describe('saved slskd connection tests', () => {
  it('tests the saved configuration and records the timestamp', async () => {
    testConnection.mockResolvedValue({ success: true, version: '0.26.0' });
    const response = await request(app).post('/api/connections/7/test');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, message: 'Connected to slskd v0.26.0', details: { version: '0.26.0' } });
    expect(configure).toHaveBeenCalledWith({ url: 'http://slskd:5030', apiKey: 'synthetic-key' });
    expect(connection.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { lastTest: expect.any(Date) } });
  });
  it('reports the provider failure instead of a missing handler', async () => {
    testConnection.mockResolvedValue({ success: false, error: 'API key rejected' });
    const response = await request(app).post('/api/connections/7/test');
    expect(response.body).toMatchObject({ success: false, message: 'API key rejected' });
  });
  it('does not contact a connection owned by someone else', async () => {
    connection.findUnique.mockResolvedValue({ id: 7, userId: 2, type: 'slskd', config: {} });
    const response = await request(app).post('/api/connections/7/test');
    expect(response.status).toBe(404);
    expect(configure).not.toHaveBeenCalled();
    expect(testConnection).not.toHaveBeenCalled();
    expect(connection.update).not.toHaveBeenCalled();
  });
});
