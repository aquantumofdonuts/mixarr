import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

afterEach(() => vi.unstubAllEnvs());
it('routes bundled API calls through loopback while preserving the API prefix and query', () => {
  vi.stubEnv('API_URL', '');
  const response = middleware(new NextRequest('http://mixarr.local/api/health?probe=1'));
  expect(response.headers.get('x-middleware-rewrite')).toBe('http://127.0.0.1:3005/api/health?probe=1');
});
it('honors the separate-container API address', () => {
  vi.stubEnv('API_URL', 'http://api:3005');
  const response = middleware(new NextRequest('http://mixarr.local/api/auth/me'));
  expect(response.headers.get('x-middleware-rewrite')).toBe('http://api:3005/api/auth/me');
});
it('leaves ordinary page requests to Next.js', () => {
  expect(middleware(new NextRequest('http://mixarr.local/library')).headers.get('x-middleware-rewrite')).toBeNull();
});
