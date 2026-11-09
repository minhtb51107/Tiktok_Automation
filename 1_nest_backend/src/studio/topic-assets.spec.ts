import { describe, it, expect } from '@jest/globals';
import { splitTopicText } from './topic-mapping';
import { inspectImage } from './studio-media';
import {
  defaultSceneVisual,
  cardPages,
  dateLabel,
} from '../video-pipeline/scene-visual';
import { validateVisual } from './editor-visual';
import { StudioService } from './studio.service';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {textHash} from './kokoro-runtime';
describe('UI-04.2 topic/layout/assets regression (OFFLINE)', () => {
  it('strips only an evidenced exact topic prefix; preserves same words in body and uncertain first lines', () => {
    expect(
      splitTopicText(
        'công việc tphcm\nMọi người nghĩ sao về công việc tphcm?',
        'công việc tphcm',
      ),
    ).toEqual({
      matched: true,
      body: 'Mọi người nghĩ sao về công việc tphcm?',
    });
    expect(
      splitTopicText(
        'Công việc Thành phố Hồ Chí Minh.\nMọi người nghĩ sao?',
        'công việc tphcm',
      ).body,
    ).toBe('Mọi người nghĩ sao?');
    expect(
      splitTopicText('Một câu mở đầu\nNội dung.', 'công việc tphcm').matched,
    ).toBe(false);
  });
  it('formats dates, paginates without dropping text and bounds geometry/volume', () => {
    expect(dateLabel('2026-08-08T12:45:54.000Z')).toBe('08/08/2026');
    expect(dateLabel('bad')).toBeNull();
    const v = defaultSceneVisual();
    v.meme.enabled = true;
    const text = Array(300).fill('nội dung').join(' '),
      layout = cardPages(text, v);
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.pages.join(' ').replace(/\s+/g, ' ')).toBe(text);
    expect(
      v.card.y + layout.height + v.meme.gap + v.meme.height,
    ).toBeLessThanOrEqual(1920);
    v.card.x = 1000;
    expect(() => validateVisual(v, () => true)).toThrow();
    v.card.x = 90;
    v.sfx.volume = 1;
    expect(() => validateVisual(v, () => true)).toThrow();
  });
  it('detects JPG/WEBP MIME and rejects mismatches, oversized/unsupported input', () => {
    const jpg = Buffer.alloc(30);
    Buffer.from([255, 216, 255, 192, 0, 17, 8, 0, 10, 0, 20]).copy(jpg);
    expect(inspectImage(jpg, 'image/jpeg')).toMatchObject({
      extension: 'jpg',
      width: 20,
      height: 10,
    });
    expect(() => inspectImage(jpg, 'image/png')).toThrow('MIME_MISMATCH');
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    webp.write('VP8X', 12);
    webp.writeUIntLE(19, 24, 3);
    webp.writeUIntLE(9, 27, 3);
    expect(inspectImage(webp, 'image/webp')).toMatchObject({
      width: 20,
      height: 10,
    });
    expect(() => inspectImage(Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow();
    expect(() => inspectImage(Buffer.alloc(30))).toThrow('UNSUPPORTED_FORMAT');
  });
  it('keeps original immutable, invalidates old narration and forbids deleting referenced, foreign and public assets', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'topic-assets-'));
    const service = new StudioService({} as ScraperService);
    Object.assign(service, { root });
    try {
      let s = await service.create();
      s = await service.mutate(s.id, {
        revision: s.revision,
        manual: {
          author: 'test',
          text: 'công việc tphcm\nBody thật.',
          comments: '',
        },
      });
      const i = s.items[0],
        original = i.originalText;
      const hash=textHash(i.spokenText);
      i.spokenApproval={textHash:hash,revision:i.revision,valid:true,approvedAt:new Date().toISOString()};
      i.voiceSettings={voice:'MOCK',speed:1.2};
      s.voiceAssets=[{id:'MOCK-audio',itemId:i.id,itemRevision:i.revision,textHash:hash,spokenText:i.spokenText,voice:'MOCK',speed:1.2,model:'MOCK',modelVersion:'MOCK',cacheKey:'MOCK',durationMs:1000,filePath:'MOCK-preserved.wav',uri:'/MOCK',createdAt:new Date().toISOString(),approvedAt:null,status:'GENERATED',cacheHit:false}];
      await fs.writeFile(path.join(root,s.id+'.json'),JSON.stringify(s));
      s = await service.mapTopic(s.id, i.id, {
        revision: s.revision,
        topic: 'công việc tphcm',
        bodyText: 'Body thật.',
        correctSpoken: true,
      });
      expect(s.items[0].originalText).toBe(original);
      expect(s.items[0].spokenText).toBe('Body thật.');
      expect(s.items[0].displayText).toBe('Body thật.');
      expect(s.items[0].contentMapping?.topic).toBe('công việc tphcm');
      expect(s.items[0].spokenApproval?.valid).toBe(false);
      expect(s.voiceAssets?.[0].status).toBe('STALE');
      expect(s.voiceAssets?.[0].filePath).toBe('MOCK-preserved.wav');
      await expect(
        service.deleteMedia(s.id, 'pub-unknown', {
          revision: s.revision,
          confirm: true,
        }),
      ).rejects.toThrow('Only an uploaded asset');
      const imageHash=textHash('new test media'),assetId='media-'+imageHash,dir=path.join(root,'media',s.id),file=path.join(dir,imageHash+'.png');
      await fs.mkdir(dir,{recursive:true});await fs.writeFile(file,'new test media');
      s.studioMedia=[{id:assetId,kind:'IMAGE',uri:'/owned-test',availability:'AVAILABLE',fileName:imageHash+'.png',sha256:imageHash,bytes:14,originalName:'owned-test.png'}];
      s.editor={scenes:[{itemId:i.id,enabled:true,paddingBeforeMs:0,paddingAfterMs:0,silentDurationMs:3000,mediaAssetIds:[assetId]}]};
      await fs.writeFile(path.join(root,s.id+'.json'),JSON.stringify(s));
      await expect(service.deleteMedia(s.id,assetId,{revision:s.revision,confirm:true,sha256:imageHash})).rejects.toThrow('still referenced');
      s.editor.scenes[0].mediaAssetIds=[];await fs.writeFile(path.join(root,s.id+'.json'),JSON.stringify(s));
      const other=await service.create();other.project.mediaAssets=[{id:'foreign-reference',kind:'IMAGE',uri:'/owned-test',availability:'AVAILABLE'}];await fs.writeFile(path.join(root,other.id+'.json'),JSON.stringify(other));
      await expect(service.deleteMedia(s.id,assetId,{revision:s.revision,confirm:true,sha256:imageHash})).rejects.toThrow('another session');
      other.project.mediaAssets=[];await fs.writeFile(path.join(root,other.id+'.json'),JSON.stringify(other));
      s.project.storyboard=[{mediaAssetIds:[assetId]} as any];await fs.writeFile(path.join(root,s.id+'.json'),JSON.stringify(s));
      await expect(service.deleteMedia(s.id,assetId,{revision:s.revision,confirm:true,sha256:imageHash})).rejects.toThrow('still referenced');
      s.project.storyboard=[];await fs.writeFile(path.join(root,s.id+'.json'),JSON.stringify(s));
      await expect(service.deleteMedia(s.id,assetId,{revision:s.revision,confirm:false,sha256:imageHash})).rejects.toThrow('explicit confirmation');
      await service.deleteMedia(s.id,assetId,{revision:s.revision,confirm:true,sha256:imageHash});await expect(fs.access(file)).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
