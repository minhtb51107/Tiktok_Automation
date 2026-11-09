import { BadRequestException } from '@nestjs/common';
import { execFile } from 'child_process';
import * as path from 'path';
import { inspectImage } from './studio-media';
export const MEDIA_CATEGORIES = [
  'MEME',
  'GIF',
  'BACKGROUND',
  'SFX',
  'BGM',
  'UPLOADS',
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];
export function validCategory(
  category: unknown,
  kind: string,
): category is MediaCategory {
  return (
    typeof category === 'string' &&
    (category === 'UPLOADS' ||
      (category === 'BACKGROUND' && ['IMAGE', 'GIF', 'VIDEO'].includes(kind)) ||
      (category === 'MEME' && kind === 'IMAGE') ||
      (category === 'GIF' && kind === 'GIF') ||
      (['SFX', 'BGM'].includes(category) && kind === 'AUDIO'))
  );
}
export function uploadSignature(
  file: { buffer: Buffer; originalname: string; mimetype?: string },
  category: unknown,
) {
  if (!file?.buffer?.length || file.buffer.length > 50 * 1024 * 1024)
    throw new BadRequestException(
      '[OVERSIZE_OR_EMPTY] Maximum upload is 50 MB; images 10 MB',
    );
  const ext = path.extname(file.originalname).slice(1).toLowerCase(),
    b = file.buffer;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    const info = inspectImage(b, file.mimetype),
      kind = info.extension === 'gif' ? 'GIF' : 'IMAGE';
    if ((ext === 'jpeg' ? 'jpg' : ext) !== info.extension)
      throw new BadRequestException(
        '[EXTENSION_MISMATCH] Image extension differs from bytes',
      );
    if (!validCategory(category, kind))
      throw new BadRequestException(
        '[CATEGORY_MISMATCH] Choose a compatible category',
      );
    return { ...info, kind };
  }
  const magic =
    ext === 'mp3'
      ? b.toString('ascii', 0, 3) === 'ID3' ||
        (b[0] === 255 && (b[1] & 224) === 224)
      : ext === 'wav'
        ? b.toString('ascii', 0, 4) === 'RIFF' &&
          b.toString('ascii', 8, 12) === 'WAVE'
        : ext === 'ogg'
          ? b.toString('ascii', 0, 4) === 'OggS'
          : ['mp4', 'm4a'].includes(ext)
            ? b.toString('ascii', 4, 8) === 'ftyp'
            : ext === 'webm'
              ? b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
              : false;
  const kind = ['mp4', 'webm'].includes(ext) ? 'VIDEO' : 'AUDIO';
  const mimes: Record<string, string[]> = {
    mp3: ['audio/mpeg', 'audio/mp3'],
    wav: ['audio/wav', 'audio/x-wav', 'audio/wave'],
    ogg: ['audio/ogg'],
    m4a: ['audio/mp4', 'audio/x-m4a'],
    mp4: ['video/mp4'],
    webm: ['video/webm'],
  };
  if (!magic || !mimes[ext])
    throw new BadRequestException(
      '[UNSUPPORTED_FORMAT] Supported: PNG JPG WEBP GIF MP4 WEBM MP3 WAV M4A OGG',
    );
  if (!mimes[ext].includes(file.mimetype || ''))
    throw new BadRequestException(
      '[MIME_MISMATCH] Declared MIME differs from media',
    );
  if (!validCategory(category, kind))
    throw new BadRequestException(
      '[CATEGORY_MISMATCH] Choose a compatible category',
    );
  return {
    extension: ext,
    mime: mimes[ext][0],
    kind,
    width: undefined as number | undefined,
    height: undefined as number | undefined,
  };
}
export const localCommand = (program: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(
      program,
      args,
      { windowsHide: true, timeout: 20000, maxBuffer: 256000 },
      (e, out) =>
        e
          ? reject(
              new BadRequestException(
                '[DECODE_ERROR] Local media validation failed',
              ),
            )
          : resolve(out),
    ),
  );
export async function probeUpload(file: string, kind: string) {
  const p = JSON.parse(
    await localCommand('ffprobe', [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      file,
    ]),
  );
  const stream = p.streams.find(
    (s: any) => s.codec_type === (kind === 'AUDIO' ? 'audio' : 'video'),
  );
  if (!stream)
    throw new BadRequestException(
      '[DECODE_ERROR] Required media stream not found',
    );
  if (
    ['AUDIO', 'VIDEO'].includes(kind) &&
    (!Number.isFinite(Number(p.format.duration)) ||
      Number(p.format.duration) <= 0)
  )
    throw new BadRequestException('[DECODE_ERROR] Measured duration required');
  await localCommand('ffmpeg', [
    '-v',
    'error',
    '-threads',
    '1',
    '-i',
    file,
    '-t',
    '1',
    '-f',
    'null',
    '-',
  ]);
  return {
    durationMs: Number.isFinite(Number(p.format.duration))
      ? Math.round(Number(p.format.duration) * 1000)
      : undefined,
    width: stream.width,
    height: stream.height,
  };
}
