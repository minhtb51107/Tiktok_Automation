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
        meta = {
          durationMs,
          width: video?.width,
          height: video?.height,
        };
        this.probes.set(key, meta);
      }
      return { ...asset, ...meta };
    }
    return asset;
  }
}
