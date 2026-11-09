import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { replaceFile } from '../studio/atomic-file';
export class ThreadsStore {
  constructor(readonly root = path.resolve('.studio-data/threads-api')) {}
  private file(key: string) {
    if (
      !/^(?:auth|runs|pages|audit)\/[A-Za-z0-9-]+\.json$/.test(key) &&
      key !== 'scheduler.json' && key !== 'collection-plan.json'
    )
      throw Error('Invalid Threads storage key');
    return path.join(this.root, key);
  }
  async read<T>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(key), 'utf8'));
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw Error('THREADS_STORAGE_READ_FAILED');
    }
  }
  async write(key: string, data: unknown) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    const tmp = f + '.' + randomUUID() + '.tmp',
      h = await fs.open(tmp, 'wx', 0o600);
    try {
      await h.writeFile(JSON.stringify(data, null, 2));
      await h.sync();
    } finally {
      await h.close();
    }
    await replaceFile(tmp, f);
  }
  async remove(key: string) {
    await fs.unlink(this.file(key)).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
  async consume(key: string) {
    const file = this.file(key),
      claim = file + '.consumed.' + randomUUID();
    try {
      await fs.rename(file, claim);
    } catch {
      throw Error('BLOCKED_AUTH: OAuth state was already consumed');
    }
    try {
      return JSON.parse(await fs.readFile(claim, 'utf8'));
    } finally {
      await fs.unlink(claim);
    }
  }
  async rows<T>(kind: 'runs' | 'audit') {
    const entries = await fs.readdir(path.join(this.root, kind)).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    const out: T[] = [];
    for (const f of entries.filter((f) => /^[a-f0-9-]+\.json$/.test(f)))
      out.push((await this.read<T>(kind + '/' + f))!);
    return out;
  }
}
