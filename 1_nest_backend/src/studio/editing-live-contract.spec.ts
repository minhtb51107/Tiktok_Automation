import { describe, it, expect } from '@jest/globals';
import {
  autoSegment,
  validateRange,
  correctSeekPrecision,
  frameRange,
  shiftSourceInMs,
} from '../video-pipeline/editing';
import { uploadSignature, validCategory } from './uploaded-media';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { editorSettings } from '../video-pipeline/editor-state';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
describe('UI-04.4 editing contracts (OFFLINE, not live proof)', () => {
  it('persists global background tracks into the VideoProject snapshot, not only editor settings',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-bg-snapshot-'));
    const service=new StudioService({} as ScraperService);Object.assign(service,{root});
    try{
      let s=await service.create();
      s=await service.mutate(s.id,{revision:s.revision,manual:{text:'Nội dung giữ nguyên.',author:'test',comments:''}});
      const original=JSON.stringify(s.items),hash='a'.repeat(64),assetId='media-'+hash;
      const dir=path.join(root,'media',s.id);await fs.mkdir(dir,{recursive:true});
      await fs.writeFile(path.join(dir,hash+'.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6wAAAABJRU5ErkJggg==','base64'));
      s.studioMedia=[{id:assetId,kind:'IMAGE',uri:'/local-test.png',availability:'AVAILABLE',fileName:hash+'.png',bytes:67,sha256:hash,originalName:'test.png',category:'BACKGROUND'}];
      s.editor=editorSettings(s);s.editor.backgroundTracks=[{id:'bg-unit',assetId,startMs:0,durationMs:3500,sourceInMs:0,sourceOutMs:3500,loop:false,enabled:true}];
      await fs.writeFile(path.join(root,s.id+'.json'),JSON.stringify(s));
      const preview=await service.preparePreview(s.id,s.revision),saved=await service.load(s.id);
      expect(saved.project.backgroundTracks).toEqual(s.editor.backgroundTracks);
      expect(saved.project.backgroundTracks).toEqual(preview.request.inputProps.backgroundTracks);
      expect(JSON.stringify(saved.items)).toBe(original);
    }finally{await fs.rm(root,{recursive:true});}
  });
 it('keeps repeated audio trims frame-aligned instead of accumulating millisecond rounding drift',()=>{let ms=0;for(let n=0;n<100;n++)ms=shiftSourceInMs(ms,1,30);expect(Math.ceil(ms*30/1000)).toBe(100);expect(shiftSourceInMs(66,-2,30)).toBe(0);expect(Math.ceil(shiftSourceInMs(0,2,30)*30/1000)).toBe(2);});
  it('uses a shared half-open frame interval for arbitrary millisecond clip trims',()=>{expect(frameRange(10,34,30)).toEqual({start:1,end:2,duration:1});expect(frameRange(3966,14000,30)).toEqual({start:119,end:539,duration:420});});
  it('corrects only fractional-microsecond seek undershoot, without a frame/rate shift or repeated seeks', () => {
    const target = 40 + 119 / 30,
      next = correctSeekPrecision(43.966666, target)!;
    expect(next).toBeGreaterThanOrEqual(target);
    expect(next - target).toBeLessThan(0.000002);
    expect(correctSeekPrecision(next, target)).toBeNull();
    expect(correctSeekPrecision(40, 40)).toBeNull();
    expect(correctSeekPrecision(43.9, target)).toBeNull();
    expect(correctSeekPrecision(NaN, target)).toBeNull();
  });
  it('chooses reproducible bounded source windows, identifies loop requirement and rejects negative/overlong trims', () => {
    const a = autoSegment(1200000, 65000, 7);
    expect(a).toEqual(autoSegment(1200000, 65000, 7));
    expect(a).not.toEqual(autoSegment(1200000, 65000, 8));
    expect(a.sourceOutMs - a.sourceInMs).toBe(65000);
    expect(a.sourceOutMs).toBeLessThanOrEqual(1200000);
    expect(autoSegment(2000, 65000, 7).loop).toBe(true);
    const c = { startMs: 0, durationMs: 65000, ...a };
    expect(validateRange(c, 1200000)).toBe(c);
    expect(() => validateRange({ ...c, sourceInMs: -1 }, 1200000)).toThrow();
    expect(() => validateRange({ ...c, durationMs: 0 }, 1200000)).toThrow();
    expect(() =>
      validateRange({ ...c, sourceOutMs: 1300000 }, 1200000),
    ).toThrow();
    expect(() => validateRange({ ...c, durationMs: 70000 }, 1200000)).toThrow();
  });
  it('restricts category roles, requires actual signatures and matching MIME/extensions', () => {
    expect(validCategory('SFX', 'IMAGE')).toBe(false);
    expect(validCategory('MEME', 'VIDEO')).toBe(false);
    expect(validCategory('GIF', 'GIF')).toBe(true);
    expect(validCategory('BACKGROUND', 'VIDEO')).toBe(true);
    expect(() =>
      uploadSignature(
        {
          buffer: Buffer.from('not audio'),
          originalname: 'test.mp3',
          mimetype: 'audio/mpeg',
        },
        'SFX',
      ),
    ).toThrow('UNSUPPORTED');
    const b = Buffer.alloc(100);
    b.write('RIFF');
    b.write('WAVE', 8);
    expect(() =>
      uploadSignature(
        { buffer: b, originalname: 'a.wav', mimetype: 'image/png' },
        'SFX',
      ),
    ).toThrow('MIME');
    expect(
      uploadSignature(
        { buffer: b, originalname: 'a.wav', mimetype: 'audio/wav' },
        'SFX',
      ).kind,
    ).toBe('AUDIO');
  });
  it('keeps DRAFT synthesis separate from approval, retains original/locks and refuses stale session writes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-draft-')),
      service = new StudioService({} as ScraperService);
    Object.assign(service, {
      root,
      voice: {
        preflight: async () => ({
          status: 'READY',
          voices: [{ id: 'my_yen' }],
          declaredVoices: [{ id: 'my_yen' }],
          model: 'mock',
          modelVersion: 'offline',
          packageVersion: 'test',
        }),
        generate: async () => ({
          filePath: path.join(root, 'not-live.wav'),
          cacheKey: 'mock',
          durationMs: 1000,
          cacheHit: false,
        }),
      },
    });
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: { text: 'Nội dung chưa duyệt.', author: 'test', comments: '' },
      });
      s = await service.runtime(s.id);
      const i = s.items[0];
      await expect(
        service.voiceAction(s.id, i.id, {
          revision: s.revision,
          action: 'GENERATE',
          voice: 'my_yen',
          speed: 1.2,
        }),
      ).rejects.toThrow('Approve');
      const out = await service.voiceAction(s.id, i.id, {
        revision: s.revision,
        action: 'GENERATE',
        draft: true,
        voice: 'my_yen',
        speed: 1.2,
      });
      expect(out.items[0].spokenApproval).toBeUndefined();
      expect(out.items[0].originalText).toBe(i.originalText);
      expect(out.items[0].manualLocks).toEqual(i.manualLocks);
      expect(out.voiceAssets![0].purpose).toBe('DRAFT');
      expect(out.voiceAssets![0].approvedAt).toBeNull();
      await expect(
        service.voiceAction(s.id, i.id, {
          revision: s.revision,
          action: 'SETTINGS',
          voice: 'my_yen',
          speed: 1.2,
        }),
      ).rejects.toThrow('changed');
    } finally {
      await fs.rm(root, { recursive: true });
    }
  });
});
