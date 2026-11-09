import { describe, it, expect } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StudioService } from './studio.service';
import { StudioController } from './studio.controller';
import { ScraperService } from '../modules/core/scraper/scraper.service';

const ready = {
  status: 'READY',
  python: 'MOCK',
  packageVersion: 'MOCK',
  imports: {},
  voices: [{ id: 'fixture', label: 'MOCK voice' }],
  declaredVoices: [{ id: 'fixture', label: 'MOCK voice' }],
  model: 'MOCK',
  modelVersion: 'MOCK',
  device: 'MOCK',
  gpuAvailable: null,
  ffmpeg: true,
  ffprobe: true,
  blockers: [],
  checkedAt: new Date().toISOString(),
};

async function fixture() {
  // The real store lives in a dot-directory (.studio-data); keep that property.
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-workflow-'));
  const root = path.join(base, '.studio-data');
  await fs.mkdir(root);
  const state = { calls: 0, inflight: 0, maxInflight: 0, failText: '' };
  const service = new StudioService({} as ScraperService);
  Object.assign(service, {
    root,
    voice: {
      preflight: async () => ready,
      generate: async (
        sessionId: string,
        text: string,
        voice: string,
        speed: number,
      ) => {
        state.calls++;
        state.inflight++;
        state.maxInflight = Math.max(state.maxInflight, state.inflight);
        try {
          await new Promise((r) => setTimeout(r, 5));
          if (text === state.failText) throw Error('MOCK inference failed');
          const dir = path.join(root, 'audio', sessionId, 'assets');
          await fs.mkdir(dir, { recursive: true });
          const name = `${state.calls}-${voice}-${speed}.wav`;
          await fs.writeFile(path.join(dir, name), 'RIFF MOCK wav bytes');
          return {
            filePath: `audio/${sessionId}/assets/${name}`,
            durationMs: 1000,
            cacheKey: 'MOCK',
            cacheHit: false,
          };
        } finally {
          state.inflight--;
        }
      },
      close: () => {},
    },
  });
  return { base, root, service, state };
}

describe('Voice workflow usability (MOCK runtime, no inference)', () => {
  it('persists full speed range, keeps spoken approval, scopes bulk settings and rejects off-step/out-of-range values', async () => {
    const { base, service } = await fixture();
    try {
      let s = await service.create();
      for (const text of ['Cảnh thử.', 't nói clm cmn.'])
        s = await service.mutate(s.id, {revision: s.revision, manual: {text, author: 'MOCK', comments: ''}});
      s = await service.runtime(s.id);
      s = await service.voiceBatch(s.id, {revision: s.revision, action: 'APPROVE_ALL_SPOKEN'});
      expect(s.items[0].spokenApproval?.valid).toBe(true);
      expect(s.items[1].spokenApproval?.valid).not.toBe(true);
      const original = s.items[0].originalText;
      for (const speed of [0.5, 1, 1.2, 1.5, 2, 2.5, 3]) {
        s = await service.voiceBatch(s.id, {revision: s.revision, action:'SETTINGS_ALL', itemIds:[s.items[0].id], voice:'fixture',speed});
        const reopened = await service.load(s.id);
        expect(reopened.items[0].voiceSettings?.speed).toBe(speed);
        expect(reopened.items[0].spokenApproval?.valid).toBe(true);
        expect(reopened.items[1].voiceSettings).toBeUndefined();
        expect(reopened.items[0].originalText).toBe(original);
      }
      for (const speed of [0.45,3.05,1.23]) await expect(service.voiceAction(s.id,s.items[0].id,{revision:s.revision,action:'SETTINGS',voice:'fixture',speed})).rejects.toThrow('0.5–3.0');
    } finally { await fs.rm(base,{recursive:true,force:true}); }
  });
  it('runs batch generation sequentially, skips unapproved/unchanged scenes and isolates failures', async () => {
    const { base, service, state } = await fixture();
    try {
      let s = await service.create();
      for (const text of ['Cảnh A.', 'Cảnh B.', 'Cảnh C.'])
        s = await service.mutate(s.id, {
          revision: s.revision,
          manual: { text, author: 'MOCK', comments: '' },
        });
      const [a, b, c] = s.items.map((i) => i.id);
      expect(s.items.every((i) => i.selected)).toBe(true);
      s = await service.runtime(s.id);
      s = await service.voiceBatch(s.id, {
        revision: s.revision,
        action: 'SETTINGS_ALL',
        voice: 'fixture',
        speed: 1.2,
      });
      expect(s.items.map((i) => i.voiceSettings?.speed)).toEqual([1.2, 1.2, 1.2]);
      for (const id of [a, b])
        s = await service.voiceAction(s.id, id, {
          revision: s.revision,
          action: 'APPROVE_SPOKEN',
        });
      state.failText = 'Cảnh B.';
      s = await service.voiceBatch(s.id, {
        revision: s.revision,
        action: 'GENERATE_ALL',
      });
      const outcome = (id: string) =>
        s.voiceBatch!.results.find((r) => r.itemId === id)!;
      expect(outcome(a).outcome).toBe('GENERATED');
      expect(outcome(b).outcome).toBe('ERROR');
      expect(outcome(b).reason).toContain('MOCK inference failed');
      expect(outcome(c).outcome).toBe('SKIPPED');
      expect(outcome(c).reason).toContain('not approved');
      expect(state.calls).toBe(2);
      expect(state.maxInflight).toBe(1);
      // Rerun: A is unchanged and valid, so it is reused; only B is retried.
      state.failText = '';
      s = await service.voiceBatch(s.id, {
        revision: s.revision,
        action: 'GENERATE_ALL',
      });
      expect(outcome(a).outcome).toBe('REUSED');
      expect(outcome(b).outcome).toBe('GENERATED');
      expect(state.calls).toBe(3);
      expect(s.voiceAssets?.filter((x) => x.itemId === a)).toHaveLength(1);
      // Approving the rest, then generating, never touches existing audio.
      s = await service.voiceBatch(s.id, {
        revision: s.revision,
        action: 'APPROVE_ALL_SPOKEN',
      });
      expect(outcome(c).outcome).toBe('APPROVED');
      expect(outcome(a).outcome).toBe('SKIPPED');
      s = await service.voiceBatch(s.id, {
        revision: s.revision,
        action: 'GENERATE_ALL',
      });
      expect(
        s.voiceBatch!.results.map((r) => r.outcome),
      ).toEqual(['REUSED', 'REUSED', 'GENERATED']);
      expect(state.maxInflight).toBe(1);
      expect(s.items.map((i) => i.originalText)).toEqual([
        'Cảnh A.',
        'Cảnh B.',
        'Cảnh C.',
      ]);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it('GENERATE carries voice/speed inline, and a speed change does not re-run the model when identical audio is valid', async () => {
    const { base, service, state } = await fixture();
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: { text: 'Một cảnh.', author: 'MOCK', comments: '' },
      });
      const id = s.items[0].id;
      s = await service.runtime(s.id);
      s = await service.voiceAction(s.id, id, {
        revision: s.revision,
        action: 'APPROVE_SPOKEN',
      });
      s = await service.voiceAction(s.id, id, {
        revision: s.revision,
        action: 'GENERATE',
        voice: 'fixture',
        speed: 1,
      });
      expect(s.items[0].voiceSettings).toEqual({ voice: 'fixture', speed: 1 });
      s = await service.voiceAction(s.id, id, {
        revision: s.revision,
        action: 'GENERATE',
        voice: 'fixture',
        speed: 1,
      });
      expect(state.calls).toBe(1);
      expect(s.voiceAssets).toHaveLength(1);
      expect(s.voiceJobs?.slice(-1)[0].reused).toBe(true);
      await expect(
        service.voiceAction(s.id, id, {
          revision: s.revision,
          action: 'GENERATE',
          voice: 'fixture',
          speed: 3.05,
        }),
      ).rejects.toThrow('Speed must be');
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it('serves audio from the dot-directory store but rejects asset paths outside the session assets folder', async () => {
    const { base, root, service } = await fixture();
    const moduleRef = await Test.createTestingModule({
      controllers: [StudioController],
      providers: [{ provide: StudioService, useValue: service }],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: { text: 'Âm thanh.', author: 'MOCK', comments: '' },
      });
      const id = s.items[0].id;
      s = await service.runtime(s.id);
      s = await service.voiceAction(s.id, id, {
        revision: s.revision,
        action: 'APPROVE_SPOKEN',
      });
      s = await service.voiceAction(s.id, id, {
        revision: s.revision,
        action: 'GENERATE',
        voice: 'fixture',
        speed: 1,
      });
      const asset = s.voiceAssets![0];
      const ok = await request(app.getHttpServer()).get(
        `/api/studio/sessions/${s.id}/audio/${asset.id}`,
      );
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toContain('audio/wav');
      const ranged = await request(app.getHttpServer())
        .get(`/api/studio/sessions/${s.id}/audio/${asset.id}`)
        .set('Range', 'bytes=0-3');
      expect(ranged.status).toBe(206);
      // A tampered reference must never leave the session assets directory.
      const file = path.join(root, s.id + '.json');
      const tampered = JSON.parse(await fs.readFile(file, 'utf8'));
      tampered.voiceAssets[0].filePath = '../../' + s.id + '.json';
      await fs.writeFile(file, JSON.stringify(tampered));
      const bad = await request(app.getHttpServer()).get(
        `/api/studio/sessions/${s.id}/audio/${asset.id}`,
      );
      expect(bad.status).toBe(400);
      const unknown = await request(app.getHttpServer()).get(
        `/api/studio/sessions/${s.id}/audio/not-an-asset`,
      );
      expect(unknown.status).toBe(400);
      const badSession = await request(app.getHttpServer()).get(
        `/api/studio/sessions/..%2F..%2Fetc/audio/${asset.id}`,
      );
      expect(badSession.status).toBeGreaterThanOrEqual(400);
    } finally {
      await app.close();
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});
