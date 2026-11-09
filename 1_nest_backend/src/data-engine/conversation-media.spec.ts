import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  cacheConversationImages,
  conversationMediaFile,
} from './conversation-media';

describe('DATA04 exact-root media manifest — OFFLINE TEST DATA', () => {
  test('keeps a source URL explicit when local caching is disabled', async () => {
    const rows = await cacheConversationImages(
      'ROOT',
      [
        { url: 'https://cdninstagram.com/root.jpg', kind: 'IMAGE' },
        { url: 'https://cdninstagram.com/root.jpg', kind: 'IMAGE' },
        { url: 'https://cdninstagram.com/video.mp4', kind: 'VIDEO' },
      ],
      '2026-01-01T00:00:00.000Z',
      '',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'URL_ONLY',
      relationEvidence: 'EXACT_ROOT_DOM_MEDIA',
      ocrStatus: 'NOT_RUN',
      rightsStatus: 'UNKNOWN',
      sha256: null,
      localUri: null,
    });
  });

  test('serves only one hash-named image inside the configured root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-media-'));
    const sha = 'a'.repeat(64), file = path.join(root, `${sha}.jpg`);
    try {
      await fs.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      await expect(conversationMediaFile(sha, root)).resolves.toBe(file);
      await expect(conversationMediaFile('../outside', root)).rejects.toThrow(
        'CONVERSATION_MEDIA_INVALID',
      );
      await expect(
        conversationMediaFile('b'.repeat(64), root),
      ).rejects.toThrow('CONVERSATION_MEDIA_UNAVAILABLE');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
import { describe, test, expect } from '@jest/globals';
