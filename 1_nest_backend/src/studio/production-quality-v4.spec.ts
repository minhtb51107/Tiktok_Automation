import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash, randomUUID } from 'crypto';
import { promises as fs, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import { PublishingService } from './publishing.service';
import { renderValidation, snapshotHash } from './render-policy';
import { isPlaceholderAvatarUrl, sourceImageUrl } from './source-images';
import { cleanSourceProjection } from './source-quality';
import { prepareTtsInput } from './speech-normalizer';
import { StudioService } from './studio.service';
import { analyzeWavBuffer, buildSceneTtsDiagnostic } from './tts-diagnostics';

const tempDirs: string[] = [];
async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tempDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

function buildTestPcm16Wav(sampleRate = 24000, durationMs = 1200): Buffer {
  const totalSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataBytes = totalSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  // 60ms leading silence, 1000ms active speech tone, 140ms trailing silence
  const leadSamples = Math.floor(sampleRate * 0.06);
  const tailStart = totalSamples - Math.floor(sampleRate * 0.14);
  for (let i = leadSamples; i < tailStart; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 9000);
    buf.writeInt16LE(val, 44 + i * 2);
  }
  return buf;
}

describe('Production Quality V4 + Publishing Recovery', () => {
  it('I. supports batch importing >= 30 URLs with deduplication, per-URL error isolation, and resume', async () => {
    const root = await makeTempDir('studio-v4-urls-');
    const service = new StudioService({} as ScraperService);
    let failUrl12 = true;
    Object.assign(service, {
      root,
      extract: async (originalUrl: string) => {
        if (originalUrl.endsWith('/post/p12') && failUrl12) {
          return {
            originalUrl,
            resolvedUrl: originalUrl,
            canonicalUrl: originalUrl,
            matchedTargetId: null,
            matchMethod: 'UNVERIFIED',
            contextCandidates: [],
            browserNavigations: 1,
            domCandidates: 0,
            status: 'ERROR',
            elapsedMs: 5,
            retrievedAt: new Date().toISOString(),
            redirects: [],
            diagnostics: [
              {
                stage: 'navigation',
                code: 'TRANSIENT_TIMEOUT',
                message: 'Simulated transient timeout on p12',
              },
            ],
            records: [],
          };
        }
        const id = originalUrl.split('/post/')[1] || 'x';
        return {
          originalUrl,
          resolvedUrl: originalUrl,
          canonicalUrl: originalUrl,
          matchedTargetId: id,
          matchMethod: 'DOM_PERMALINK',
          contextCandidates: [],
          browserNavigations: 1,
          domCandidates: 1,
          status: 'SUCCESS',
          elapsedMs: 2,
          retrievedAt: new Date().toISOString(),
          redirects: [],
          diagnostics: [],
          records: [
            {
              url: originalUrl,
              text: `Bài viết số ${id} có đầy đủ nội dung.`,
              author: `user_${id}`,
              handle: `user_${id}`,
              avatar: null,
              createdAt: '2026-11-20T00:00:00.000Z',
              type: 'POST',
              parentReference: null,
              media: [],
              likeCount: 10,
              replyCount: 2,
              repostCount: 0,
              provenance: { text: 'test' },
            },
          ],
        };
      },
    });

    let s = await service.create();
    const valid30 = Array.from(
      { length: 30 },
      (_, idx) => `https://www.threads.com/@user_${idx + 1}/post/p${idx + 1}`,
    );
    const duplicates3 = [valid30[0], valid30[4], valid30[9]];
    const malformed2 = [
      'http://not-https.threads.com/@bad/post/1',
      'https://evil.example.com/@bad/post/2',
    ];
    const submitted35 = [...valid30, ...duplicates3, ...malformed2];
    expect(submitted35).toHaveLength(35);

    s = await service.mutate(
      s.id,
      {
        revision: s.revision,
        urls: submitted35,
        scope: 'TARGET_ONLY',
      },
      true,
    );

    expect(s.urlQueue).toMatchObject({
      submittedCount: 35,
      uniqueValidCount: 30,
      duplicateCount: 3,
      malformedCount: 2,
      processedCount: 30,
      succeededCount: 29,
      failedCount: 3, // 2 malformed + 1 transient timeout on p12
      concurrency: 1,
    });
    expect(s.items).toHaveLength(29);
    expect(s.attempts).toHaveLength(32); // 30 valid + 2 malformed

    // Resume only the failed URL without re-fetching the 29 already-succeeded URLs
    failUrl12 = false;
    s = await service.mutate(
      s.id,
      {
        revision: s.revision,
        urls: valid30,
        scope: 'TARGET_ONLY',
        resumeOnly: true,
      },
      true,
    );
    expect(s.urlQueue).toMatchObject({
      uniqueValidCount: 30,
      processedCount: 1,
      skippedReadyCount: 29,
      succeededCount: 30,
      failedCount: 0,
    });
    expect(s.items).toHaveLength(30);
  });

  it('II & III. preserves originalText/displayText, normalizes spoken + and vd, strips UI badge chrome, and diagnoses WAV waveforms', () => {
    const rawWithBadge: any = {
      text: '·\nTác giả\nNếu 1 đứa con tự chọn kết thúc, bố mẹ có hối hận không?',
      bodyText:
        '·\nTác giả\nNếu 1 đứa con tự chọn kết thúc, bố mẹ có hối hận không?',
      author: 'chang_chang72',
      handle: 'chang_chang72',
      avatar: null,
      createdAt: null,
      type: 'COMMENT',
      parentReference: null,
      media: [],
      likeCount: 8,
      replyCount: 0,
      repostCount: 0,
      provenance: { text: 'owned DOM card' },
    };
    const projected = cleanSourceProjection(rawWithBadge);
    expect(projected.text).toBe(
      'Nếu 1 đứa con tự chọn kết thúc, bố mẹ có hối hận không?',
    );
    expect(rawWithBadge.text).toContain('Tác giả');

    const plusTts = prepareTtsInput(
      'tiền bằng + ngoại ngữ là +2tr500 mỗi tháng',
    );
    expect(plusTts.spokenText).toBe(
      'tiền bằng cộng ngoại ngữ là cộng hai triệu năm trăm nghìn mỗi tháng',
    );

    const vdVideo = prepareTtsInput('Bữa mình thấy vd trên tiktok rất hay');
    expect(vdVideo.spokenText).toContain('thấy video trên tiktok');

    const vdExample = prepareTtsInput('Cho mình 1 vd cụ thể đi bạn');
    expect(vdExample.spokenText).toContain('một ví dụ cụ thể');

    const wav = buildTestPcm16Wav(24000, 1200);
    const waveform = analyzeWavBuffer(wav)!;
    expect(waveform.sampleRate).toBe(24000);
    expect(waveform.channels).toBe(1);
    expect(waveform.durationMs).toBe(1200);
    expect(waveform.speechRatio).toBeGreaterThan(0.75);

    const diag = buildSceneTtsDiagnostic({
      itemId: 'scene-1',
      originalText: 'Bữa mình thấy vd trên tiktok( không chắc số ngày).',
      displayText: 'Bữa mình thấy vd trên tiktok( không chắc số ngày).',
      spokenText: 'Bữa mình thấy video trên tiktok( không chắc số ngày).',
      ttsInputText: 'Bữa mình thấy video trên tiktok( không chắc số ngày).',
      normalizationVersion: 'vi-speech-norm/3',
      waveform,
      wavDurationMs: 1200,
    });
    expect(diag.originalText).toBe(
      'Bữa mình thấy vd trên tiktok( không chắc số ngày).',
    );
    expect(diag.ttsTransportText).not.toContain('(');
    expect(diag.ttsTransportText).not.toContain(')');
    expect(diag.status).toBe('PASS');
  });

  it('IV. preserves real author avatarUrl across mutate saves, resolves reply avatars from ThreadCollection, and rejects placeholder sprites', async () => {
    expect(
      isPlaceholderAvatarUrl(
        'https://static.cdninstagram.com/rsrc.php/v1/yb/r/5OTfmveiK1K.jpg',
      ),
    ).toBe(true);
    expect(() =>
      sourceImageUrl(
        'https://static.cdninstagram.com/rsrc.php/v1/yb/r/5OTfmveiK1K.jpg',
      ),
    ).toThrow('AVATAR_UNAVAILABLE');

    const realCdn =
      'https://scontent.cdninstagram.com/v/t51.82787-19/553874814_17847819608568077_6196045907107222668_n.jpg';
    expect(isPlaceholderAvatarUrl(realCdn)).toBe(false);
    expect(sourceImageUrl(realCdn).hostname).toBe('scontent.cdninstagram.com');

    const root = await makeTempDir('studio-v4-avatars-');
    const service = new StudioService({} as ScraperService);
    Object.assign(service, { root });

    let s = await service.create();
    s = await service.mutate(s.id, {
      revision: s.revision,
      manual: { text: 'Bài gốc thật', author: 'bs_Chau', comments: '' },
    });
    s.items[0].author.avatarUrl = realCdn;
    s.items[0].metadata!.avatar = realCdn;
    await fs.writeFile(path.join(root, s.id + '.json'), JSON.stringify(s));

    const updated = await service.mutate(s.id, {
      revision: s.revision,
      title: 'Updated title',
      items: s.items.map((item) => ({
        ...item,
        spokenText: 'Bài gốc thật đã chỉnh',
      })),
    });
    expect(updated.items[0].author.avatarUrl).toBe(realCdn);
  });

  it('V. emits SOURCE_RESOLUTION_LIMIT and non-blocking MANUAL_DURATION_ADVISORY warnings in renderValidation', () => {
    const itemId = randomUUID(),
      audioId = randomUUID(),
      text = 'Nội dung kiểm tra render policy';
    const session: any = {
      id: randomUUID(),
      revision: 1,
      project: {},
      items: [
        {
          id: itemId,
          selected: true,
          spokenText: text,
          voiceSettings: { voice: 'my_yen', speed: 1.2 },
          spokenApproval: { valid: true, textHash: 'ok' },
        },
      ],
      voiceAssets: [],
    };
    const props: any = {
      timeline: {
        width: 1080,
        height: 1920,
        fps: 30,
        totalFrames: 30 * 95, // 95s > 90s
        scenes: [],
      },
      mediaAssets: [
        {
          id: 'pub-backgrounds-source-3-mp4',
          kind: 'VIDEO',
          uri: '/api/studio/public-assets/pub-backgrounds-source-3-mp4',
          width: 720,
          height: 1280,
        },
      ],
      audioAssets: [],
      backgroundTracks: [
        {
          id: 'bg-1',
          assetId: 'pub-backgrounds-source-3-mp4',
          startMs: 0,
          durationMs: 95000,
          sourceInMs: 0,
          sourceOutMs: 95000,
          loop: false,
          enabled: true,
        },
      ],
    };
    const v = renderValidation(session, props);
    expect(v.blockers).toHaveLength(0);
    expect(v.warnings.join('\n')).toContain('SOURCE_RESOLUTION_LIMIT');
    expect(v.warnings.join('\n')).toContain('720x1280');
    expect(v.warnings.join('\n')).toContain('MANUAL_DURATION_ADVISORY');
  });

  it('VI. enforces compliant TikTok Browser Upload queue, SHA-256 binding, human confirmation gate, UNKNOWN retry lock, and preserves MP4 file on disk', async () => {
    const uploaderSource = readFileSync(
      path.resolve('src/modules/core/uploader/tiktok-upload.service.ts'),
      'utf8',
    );
    expect(uploaderSource).not.toContain('puppeteer-extra-plugin-stealth');
    expect(uploaderSource).not.toContain('unlinkSync');

    const root = await makeTempDir('studio-v4-publish-');
    const sessionId = randomUUID(),
      renderJobId = randomUUID();
    const mp4Path = path.join(root, 'video.mp4');
    const mp4Bytes = Buffer.from('FAKE_MP4_BINARY_FOR_QUEUE_VERIFICATION');
    await fs.writeFile(mp4Path, mp4Bytes);
    const expectedSha = createHash('sha256').update(mp4Bytes).digest('hex');

    const manifest: any = {
      jobId: renderJobId,
      sessionId,
      mode: 'DRAFT',
      status: 'COMPLETED',
      width: 1080,
      height: 1920,
      expectedDurationSeconds: 64.733,
      previewHash: snapshotHash({ ok: true }),
    };
    const studioStub: any = {
      load: async () => ({
        id: sessionId,
        revision: 1,
        title: 'Threads Draft · @bs_Chau',
        project: {
          id: sessionId,
          publishing: {
            caption: 'Ca trực đêm ở bệnh viện',
            hashtags: ['threads', 'chuyennghe'],
          },
        },
        items: [],
      }),
      preview: async () => ({ request: { inputProps: {} } }),
      renders: {
        load: async () => manifest,
        output: async () => mp4Path,
      },
    };
    const publishing = new PublishingService(studioStub);
    (publishing as any).root = path.join(root, 'publishing');

    const queued = await publishing.enqueueBrowserUpload(sessionId, {
      renderJobId,
      accountLabel: 'SERIOUS_CHANNEL',
      caption: 'Ca trực đêm ở bệnh viện',
      hashtags: ['threads', 'chuyennghe'],
      expectedSha256: expectedSha,
    });
    expect(queued.state).toBe('QUEUED');
    expect(queued.mp4Sha256).toBe(expectedSha);
    expect(queued.renderJobId).toBe(renderJobId);

    const prepared = await publishing.prepareBrowserUpload(
      sessionId,
      queued.id,
      { launchBrowser: false },
    );
    expect(prepared.state).toBe('READY_FOR_CONFIRMATION');
    expect(prepared.humanConfirmationToken).toContain('CONFIRM_PUBLISH_');
    expect(prepared.transitions.map((t) => t.state)).toEqual([
      'QUEUED',
      'PREPARING',
      'UPLOADING',
      'READY_FOR_CONFIRMATION',
    ]);

    // Verify human confirmation gate without public posting
    const gateVerified = await publishing.confirmBrowserUpload(
      sessionId,
      queued.id,
      {
        confirmationToken: prepared.humanConfirmationToken!,
        action: 'VERIFY_GATE_ONLY',
      },
    );
    expect(gateVerified.state).toBe('READY_FOR_CONFIRMATION');
    expect(gateVerified.humanConfirmedAt).toBeTruthy();

    // Simulate ambiguous post outcome -> UNKNOWN state -> retry must be blocked!
    const ambiguous = await publishing.confirmBrowserUpload(
      sessionId,
      queued.id,
      {
        confirmationToken: prepared.humanConfirmationToken!,
        action: 'SIMULATE_AMBIGUOUS',
      },
    );
    expect(ambiguous.state).toBe('UNKNOWN');
    expect(ambiguous.postClicked).toBe(true);
    expect(ambiguous.retryAllowed).toBe(false);
    await expect(
      publishing.retryBrowserUpload(sessionId, queued.id),
    ).rejects.toThrow('RETRY_BLOCKED_UNKNOWN_OR_POST_CLICKED');

    // Verify the MP4 file on disk was NEVER deleted
    const afterStat = await fs.stat(mp4Path);
    expect(afterStat.size).toBe(mp4Bytes.length);
  });
});
