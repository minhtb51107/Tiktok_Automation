import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { fetchPublicImage } from '../studio/source-images';
import { inspectImage } from '../studio/studio-media';
import type { PublicPost } from './conversation-contracts';

type Attachment = NonNullable<PublicPost['attachments']>[number];

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : 'Media download failed')
    .replace(/https?:\S+/g, '[public URL]')
    .slice(0, 160);
}

/** Exact-root media only. No avatar/context URL is accepted by this adapter. */
export async function cacheConversationImages(
  rootId: string,
  rows: Array<{ url: string; kind: string }>,
  observedAt: string,
  mediaRoot = process.env.STUDIO_DATA04_MEDIA_ROOT?.trim() || '',
): Promise<Attachment[]> {
  const unique = [
    ...new Map(
      rows.filter((x) => x.kind === 'IMAGE').map((x) => [x.url, x]),
    ).values(),
  ];
  const out: Attachment[] = [];
  for (const [index, row] of unique.slice(0, 4).entries()) {
    const base: Attachment = {
      id: createHash('sha256')
        .update(`${rootId}:${index}:${row.url}`)
        .digest('hex'),
      kind: 'IMAGE',
      sourceUrl: row.url,
      relationEvidence: 'EXACT_ROOT_DOM_MEDIA',
      status: 'URL_ONLY',
      mimeType: null,
      width: null,
      height: null,
      bytes: null,
      sha256: null,
      localUri: null,
      error: mediaRoot ? null : 'Local media cache is not configured',
      observedAt,
      ocrStatus: 'NOT_RUN',
      rightsStatus: 'UNKNOWN',
    };
    if (!mediaRoot) {
      out.push(base);
      continue;
    }
    try {
      const bytes = await fetchPublicImage(row.url),
        info = inspectImage(bytes),
        sha256 = createHash('sha256').update(bytes).digest('hex'),
        file = path.resolve(mediaRoot, `${sha256}.${info.extension}`),
        root = path.resolve(mediaRoot);
      if (path.dirname(file) !== root) throw Error('Invalid media cache path');
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 }).catch((e) => {
        if (e.code !== 'EEXIST') throw e;
      });
      await new Promise<void>((resolve, reject) =>
        execFile(
          'ffmpeg',
          ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'null', '-'],
          { windowsHide: true, timeout: 15000 },
          (error) =>
            error ? reject(Error('Image decode failed')) : resolve(),
        ),
      );
      out.push({
        ...base,
        status: 'DOWNLOADED',
        mimeType: info.mime,
        width: info.width,
        height: info.height,
        bytes: bytes.length,
        sha256,
        localUri: `/api/studio/data/conversations/media/${sha256}`,
        error: null,
      });
    } catch (error) {
      out.push({ ...base, status: 'UNAVAILABLE', error: safeError(error) });
    }
  }
  return out;
}

export async function conversationMediaFile(sha: string, mediaRoot?: string) {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw Error('CONVERSATION_MEDIA_INVALID');
  const configured = mediaRoot || process.env.STUDIO_DATA04_MEDIA_ROOT?.trim();
  if (!configured) throw Error('CONVERSATION_MEDIA_UNAVAILABLE');
  const root = path.resolve(configured);
  const matches = (
    await Promise.all(
      ['jpg', 'png', 'webp', 'gif'].map(async (ext) => {
        const file = path.join(root, `${sha}.${ext}`);
        return (await fs.stat(file).catch(() => null))?.isFile() ? file : null;
      }),
    )
  ).filter((x): x is string => !!x);
  if (matches.length !== 1) throw Error('CONVERSATION_MEDIA_UNAVAILABLE');
  return matches[0];
}
