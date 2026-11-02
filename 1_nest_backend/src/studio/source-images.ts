import { request } from 'https';
import { lookup } from 'dns/promises';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { inspectImage } from './studio-media';
export interface LocalSourceImage {
  itemId: string;
  sourceUrl: string;
  status: 'READY' | 'UNAVAILABLE';
  uri: string | null;
  fileName?: string;
  sha256?: string;
  bytes?: number;
  error: string | null;
  provenance: 'PUBLIC_CDN' | 'USER_UPLOAD';
  checkedAt: string;
}
export function sourceImageUrl(raw: string) {
  const u = new URL(raw);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    !/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(u.hostname)
  )
    throw Error('Unsupported public image domain');
  return u;
}
export function publicV4(ip: string) {
  const n = ip.split('.').map(Number);
  return (
    n.length === 4 &&
    n.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) &&
    ![0, 10, 127].includes(n[0]) &&
    n[0] < 224 &&
    !(n[0] === 169 && n[1] === 254) &&
    !(n[0] === 192 && n[1] === 168) &&
    !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
    !(n[0] === 100 && n[1] >= 64 && n[1] <= 127) &&
    !(n[0] === 198 && (n[1] === 18 || n[1] === 19))
  );
}
export async function fetchPublicImage(
  raw: string,
  redirects = 0,
): Promise<Buffer> {
  if (redirects > 3) throw Error('Image redirect limit');
  const u = sourceImageUrl(raw);
  const address = (await lookup(u.hostname, { all: true })).find(
    (x) => x.family === 4 && publicV4(x.address),
  );
  if (!address) throw Error('No public image address');
  return new Promise((resolve, reject) => {
    const req = request(
      u,
      {
        lookup: (_host, options, cb: any) =>
          options.all
            ? cb(null, [{ address: address.address, family: 4 }])
            : cb(null, address.address, 4),
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode || 0) &&
          res.headers.location
        ) {
          res.resume();
          void fetchPublicImage(
            new URL(res.headers.location, u).href,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(Error('PUBLIC_IMAGE_HTTP_' + res.statusCode));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (b) => {
          size += b.length;
          if (size > 3 * 1024 * 1024) {
            req.destroy(Error('Avatar exceeds 3MB'));
            return;
          }
          chunks.push(b);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      },
    );
    const deadline = setTimeout(
      () => req.destroy(Error('Public image timeout')),
      12000,
    );
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end();
  });
}
export async function cacheSourceImage(
  sessionId: string,
  itemId: string,
  sourceUrl: string,
  root = path.resolve('.studio-data/source-images'),
): Promise<LocalSourceImage> {
  const base = {
    itemId,
    sourceUrl,
    uri: null,
    provenance: 'PUBLIC_CDN' as const,
    checkedAt: new Date().toISOString(),
  };
  try {
    const bytes = await fetchPublicImage(sourceUrl),
      info = inspectImage(bytes),
      sha256 = createHash('sha256').update(bytes).digest('hex'),
      fileName = sha256 + '.' + info.extension,
      dir = path.join(root, sessionId),
      file = path.join(dir, fileName);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, bytes, { flag: 'wx' }).catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
    await new Promise<void>((resolve, reject) =>
      execFile(
        'ffmpeg',
        ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'null', '-'],
        { windowsHide: true, timeout: 15000 },
        (e) => (e ? reject(Error('Avatar decode failed')) : resolve()),
      ),
    );
    return {
      ...base,
      status: 'READY',
      fileName,
      sha256,
      bytes: bytes.length,
      error: null,
      uri: `/api/studio/sessions/${sessionId}/source-images/${sha256}`,
    };
  } catch (e) {
    return {
      ...base,
      status: 'UNAVAILABLE',
      error: (e as Error).message
        .replace(/https?:\S+/g, '[public URL]')
        .slice(0, 160),
    };
  }
}
