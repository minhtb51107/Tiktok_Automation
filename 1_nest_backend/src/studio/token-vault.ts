import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { replaceFile } from './atomic-file';
export class TokenVault {
  constructor(
    private root = path.resolve('.studio-data/publishing/vault'),
    private secret = process.env.STUDIO_TOKEN_KEY || '',
  ) {}
  private key() {
    const k = Buffer.from(this.secret, 'base64');
    if (k.length !== 32)
      throw Error(
        'BLOCKED_AUTH: configure a private 32-byte STUDIO_TOKEN_KEY outside source',
      );
    return k;
  }
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid account ID');
    return path.join(this.root, id + '.json');
  }
  async write(id: string, value: unknown) {
    const key = this.key(),
      iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    await fs.mkdir(this.root, { recursive: true });
    const f = this.file(id);
    await fs.writeFile(
      f + '.tmp',
      JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      }),
      { mode: 0o600 },
    );
    await replaceFile(f + '.tmp', f);
  }
  async read(id: string) {
    try {
      const data = JSON.parse(await fs.readFile(this.file(id), 'utf8')),
        d = createDecipheriv(
          'aes-256-gcm',
          this.key(),
          Buffer.from(data.iv, 'base64'),
        );
      d.setAAD(Buffer.from(id));
      d.setAuthTag(Buffer.from(data.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          d.update(Buffer.from(data.ciphertext, 'base64')),
          d.final(),
        ]).toString('utf8'),
      );
    } catch {
      throw Error(
        'BLOCKED_AUTH: encrypted account token unavailable or invalid',
      );
    }
  }
  async remove(id: string) {
    await fs.unlink(this.file(id)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}
