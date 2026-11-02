import { Test } from '@nestjs/testing';
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ThreadsController, ThreadsDiscoveryService } from './controller';
import request = require('supertest');

describe('Threads local HTTP contract — MOCK ONLY', () => {
  let app: any;
  const svc = {
    auth: { status: jest.fn<() => Promise<any>>(), begin: jest.fn<() => Promise<any>>(), callback: jest.fn<() => Promise<any>>() },
    collector: { isActive: () => false, start: jest.fn() },
    scheduler: { status: jest.fn() },
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    const m = await Test.createTestingModule({
      controllers: [ThreadsController],
      providers: [{ provide: ThreadsDiscoveryService, useValue: svc }],
    }).compile();
    app = m.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  it('exposes blocked status without starting discovery and rejects cross-origin triggers', async () => {
    svc.auth.status.mockResolvedValue({ status: 'BLOCKED_AUTH' });
    await request(app.getHttpServer())
      .get('/api/studio/threads/auth/status')
      .expect(200, { status: 'BLOCKED_AUTH' });
    await request(app.getHttpServer())
      .post('/api/studio/threads/collector/runs')
      .set('Origin', 'https://untrusted.test')
      .send({})
      .expect(403);
    expect(svc.collector.start).not.toHaveBeenCalled();
  });
  it('sets secure browser-bound state and redirects only after explicit login', async () => {
    svc.auth.begin.mockResolvedValue({
      url: 'https://www.threads.com/oauth/authorize?state=SYNTHETIC',
      binding: 'a'.repeat(64),
    });
    const r = await request(app.getHttpServer())
      .get('/api/studio/threads/oauth/login')
      .set('Host', 'threads-studio.test:3443')
      .expect(302);
    expect(r.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(r.headers['set-cookie'][0]).toMatch(/Secure/);
    expect(r.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(svc.auth.callback).not.toHaveBeenCalled();
  });
  it('clears callback cookie on failure without echoing codes or throwing headers-sent errors', async () => {
    const r = await request(app.getHttpServer())
      .get(
        '/api/studio/threads/oauth/callback?code=SYNTHETIC_CODE&state=SYNTHETIC_STATE',
      )
      .expect(400);
    expect(r.headers['set-cookie'][0]).toContain('studio_threads_state=;');
    expect(r.text).toContain('BLOCKED_AUTH');
    expect(r.text).not.toContain('SYNTHETIC_CODE');
    expect(svc.collector.start).not.toHaveBeenCalled();
  });
});
