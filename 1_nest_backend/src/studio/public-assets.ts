import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { BadRequestException } from '@nestjs/common';
export interface LibraryAsset {
  id: string;
  name: string;
  relativePath: string;
  uri: string;
  category: 'BACKGROUND' | 'MEME' | 'GIF' | 'SFX' | 'BGM' | 'OTHER';
  kind: 'IMAGE' | 'VIDEO' | 'GIF' | 'AUDIO' | 'OTHER';
  bytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  stableSourceInMs?: number;
  usage?: 'SERIOUS_GAMEPLAY';
}
// Reviewed local library entries. Folder membership alone does not establish
// gameplay: this library also contains non-game footage.
const reviewedGameplay = ['backgrounds/source_3.mp4', 'backgrounds/source_4.mp4', 'backgrounds/source_8.mp4'];
export function seriousDraftAssets(assets: LibraryAsset[], preferredIds: string[] = []) {
  const videos = assets.filter(asset => asset.category === 'BACKGROUND' && asset.kind === 'VIDEO' && asset.bytes > 0);
  const gameplay = preferredIds.length
    ? preferredIds.flatMap(id => videos.filter(asset => asset.id === id))
    : videos.filter(asset => asset.usage === 'SERIOUS_GAMEPLAY');
  const bgm = assets.find(
    (asset) =>
      asset.category === 'BGM' &&
      asset.kind === 'AUDIO' &&
      asset.relativePath.toLocaleLowerCase() === 'bgm/lofi.mp3',
  );
  return { gameplay, bgm: bgm ?? null };
}
export class PublicAssets {
  private probes = new Map<string, Partial<LibraryAsset>>();
  constructor(private root = path.resolve('../2_Remotion_Video/public')) {}
  async inventory(): Promise<LibraryAsset[]> {
    const rows: LibraryAsset[] = [];
    const walk = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink()) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(f);
          continue;
        }
        const ext = path.extname(f).toLowerCase(),
          rel = path.relative(this.root, f).replace(/\\/g, '/'),
          folder = rel.split('/')[0];
        const kind: LibraryAsset['kind'] = /\.(png|jpe?g|webp|svg)$/.test(ext)
          ? 'IMAGE'
          : ext === '.gif'
            ? 'GIF'
            : /\.(mp4|webm|mov)$/.test(ext)
              ? 'VIDEO'
              : /\.(mp3|wav|m4a|ogg)$/.test(ext)
                ? 'AUDIO'
                : 'OTHER';
        const category: LibraryAsset['category'] =
          folder === 'backgrounds'
            ? 'BACKGROUND'
            : folder === 'memes'
              ? 'MEME'
              : folder === 'gifs'
                ? 'GIF'
                : folder === 'sfx'
                  ? 'SFX'
                  : folder === 'bgm'
                    ? 'BGM'
                    : 'OTHER';
        const id = 'pub-' + createHash('sha256').update(rel).digest('hex');
        rows.push({
          id,
          name: e.name,
          relativePath: rel,
          uri: '/api/studio/public-assets/' + id,
          kind,
          category,
          bytes: (await fs.stat(f)).size,
          ...(reviewedGameplay.includes(rel) ? {usage: 'SERIOUS_GAMEPLAY' as const} : {}),
        });
      }
    };
    try {
      await walk(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }
  async file(id: string) {
    const a = (await this.inventory()).find((a) => a.id === id);
    if (!a || a.kind === 'OTHER')
      throw new BadRequestException('Unknown public media asset');
    const file = path.resolve(this.root, a.relativePath),
      real = await fs.realpath(file),
      root = await fs.realpath(this.root);
    if (!real.startsWith(root + path.sep))
      throw new BadRequestException('Unsafe public path');
    return { asset: a, file: real };
  }
  async resolve(id: string) {
    const { asset, file } = await this.file(id);
    if (asset.kind === 'AUDIO' || asset.kind === 'VIDEO') {
      const stat = await fs.stat(file),
        key = id + ':' + stat.size + ':' + stat.mtimeMs;
      let meta = this.probes.get(key);
      if (!meta) {
        const raw = await new Promise<string>((resolve, reject) =>
          execFile(
            'ffprobe',
            [
              '-v',
              'error',
              '-show_entries',
              'format=duration:stream=codec_type,duration,width,height',
              '-of',
              'json',
              file,
            ],
            { windowsHide: true, timeout: 15000, maxBuffer: 100000 },
            (e, out) =>
              e
                ? reject(new BadRequestException('Public asset FFprobe failed'))
                : resolve(out),
          ),
        );
        const probe = JSON.parse(raw);
        const video = probe.streams?.find((s: any) => s.codec_type === 'video' && s.width > 0 && s.height > 0);
        if (asset.kind === 'VIDEO' && !video)
          throw new BadRequestException('Public asset has no valid video stream');
        const streamDuration = Number(video?.duration);
        const durationMs = Math.floor((streamDuration > 0 ? streamDuration : Number(probe.format?.duration)) * 1000);
        if (!Number.isFinite(durationMs) || durationMs <= 0)
          throw new BadRequestException('Public asset duration unavailable');
        let stableSourceInMs = 0;
        if (asset.kind === 'VIDEO' && durationMs >= 4000) {
          stableSourceInMs = await this.detectStableVideoStartMs(file, durationMs);
        }
        meta = {
          durationMs,
          width: video?.width,
          height: video?.height,
          ...(asset.kind === 'VIDEO' ? { stableSourceInMs } : {}),
        };
        this.probes.set(key, meta);
      }
      return { ...asset, ...meta };
    }
    return asset;
  }

  private async detectStableVideoStartMs(file: string, durationMs: number): Promise<number> {
    try {
      const raw = await new Promise<Buffer>((resolve, reject) =>
        execFile(
          'ffmpeg',
          [
            '-v',
            'error',
            '-t',
            '4.0',
            '-i',
            file,
            '-vf',
            'fps=10,scale=64:64',
            '-f',
            'rawvideo',
            '-pix_fmt',
            'gray',
            '-',
          ],
          { windowsHide: true, timeout: 15000, maxBuffer: 512 * 1024, encoding: 'buffer' },
          (e, out) => (e ? reject(e) : resolve(out)),
        ),
      );
      const frameBytes = 64 * 64;
      const count = Math.floor(raw.length / frameBytes);
      if (count < 6) return 0;
      const lumas: number[] = [];
      const sharps: number[] = [];
      for (let f = 0; f < count; f++) {
        const offset = f * frameBytes;
        let sum = 0;
        let grad = 0;
        for (let y = 0; y < 64; y++) {
          const row = offset + y * 64;
          for (let x = 0; x < 64; x++) {
            const v = raw[row + x];
            sum += v;
            if (x > 0) grad += Math.abs(v - raw[row + x - 1]);
            if (y > 0) grad += Math.abs(v - raw[row - 64 + x]);
          }
        }
        lumas.push(sum / frameBytes);
        sharps.push(grad / (63 * 64));
      }
      const tailStart = Math.min(15, count - 1);
      const tailLumas = lumas.slice(tailStart).sort((a, b) => a - b);
      const tailSharps = sharps.slice(tailStart).sort((a, b) => a - b);
      const p65Luma = tailLumas[Math.min(tailLumas.length - 1, Math.floor(tailLumas.length * 0.65))];
      const medianSharp = tailSharps[Math.floor(tailSharps.length * 0.5)];
      const targetLuma = p65Luma * 0.88;
      const targetSharp = medianSharp * 0.78;
      if (lumas[0] >= targetLuma && sharps[0] >= targetSharp) return 0;
      for (let i = 1; i < count - 1; i++) {
        if (
          lumas[i] >= targetLuma &&
          sharps[i] >= targetSharp &&
          lumas[i] - lumas[i - 1] < 8.0
        ) {
          return Math.min(i * 100, Math.max(0, durationMs - 1000));
        }
      }
      return 0;
    } catch {
      return 0;
    }
  }
}
