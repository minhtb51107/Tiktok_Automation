import { BadRequestException } from '@nestjs/common';
// Signature/dimension validation before any browser decoding; no SVG or executable uploads.
export function inspectImage(b: Buffer, declaredMime?: string) {
  if (!Buffer.isBuffer(b) || b.length < 24 || b.length > 10 * 1024 * 1024)
    throw new BadRequestException(
      '[OVERSIZE_OR_EMPTY] Image must be 24 bytes–10 MB',
    );
  let extension: string, width = 0, height = 0;
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    extension = 'png';
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else if (['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6))) {
    extension = 'gif';
    width = b.readUInt16LE(6);
    height = b.readUInt16LE(8);
  } else if (b[0] === 255 && b[1] === 216) {
    extension = 'jpg';
    let offset = 2;
    while (offset + 4 < b.length) {
      if (b[offset++] !== 255) continue;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const len = b.readUInt16BE(offset);
      if (len < 2 || offset + len > b.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        len >= 7
      ) {
        height = b.readUInt16BE(offset + 3);
        width = b.readUInt16BE(offset + 5);
        break;
      }
      offset += len;
    }
  } else if (
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    extension = 'webp';
    const format = b.toString('ascii', 12, 16);
    if (format === 'VP8X' && b.length >= 30) {
      width = b.readUIntLE(24, 3) + 1;
      height = b.readUIntLE(27, 3) + 1;
    } else if (format === 'VP8L' && b.length >= 25 && b[20] === 47) {
      width = 1 + (b[21] | ((b[22] & 63) << 8));
      height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 15) << 10));
    } else if (
      format === 'VP8 ' &&
      b.length >= 30 &&
      b.subarray(23, 26).equals(Buffer.from([157, 1, 42]))
    ) {
      width = b.readUInt16LE(26) & 0x3fff;
      height = b.readUInt16LE(28) & 0x3fff;
    }
  } else
    throw new BadRequestException(
      '[UNSUPPORTED_FORMAT] Choose PNG, JPG/JPEG, WEBP or GIF',
    );
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 24000000
  )
    throw new BadRequestException(
      '[INVALID_DIMENSIONS] Image dimensions exceed safe preview limit or header is invalid',
    );
  const mime = {
    png: 'image/png',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    webp: 'image/webp',
  }[extension]!;
  if (declaredMime && declaredMime !== mime)
    throw new BadRequestException(
      '[MIME_MISMATCH] MIME does not match actual image signature',
    );
  return { extension, width, height, mime };
}
