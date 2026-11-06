import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { replaceFile } from '../studio/atomic-file';
import {DATA_SCHEMA} from './contracts';
import {hash} from './rules';
/** Same local JSON/atomic-rename strategy as Studio. One backend writer only. */
export class DataStore {
  constructor(
    readonly root = process.env.STUDIO_DATA_ROOT
      ? path.resolve(process.env.STUDIO_DATA_ROOT, 'data-engine')
      : path.resolve('.studio-data/data-engine'),
  ) {}
  private file(key: string) {
    if (!/^(posts|bronze|evaluations|runs|production-jobs|crawler-runs|gold-shadows|gold-feedback|conversation-runs|thread-collections|thread-replies|conversation-feedback|editorial-plans)\/[a-f0-9]{64}\.json$/.test(key))
      throw Error('Invalid data storage key');
    return path.join(this.root, key);
  }
  async read<T>(key: string): Promise<T | null> {
    try {
      const value=JSON.parse(await fs.readFile(this.file(key), 'utf8'));
      if(value.schemaVersion!==DATA_SCHEMA)throw Error('DATA_SCHEMA_UNSUPPORTED: '+key);
      if(key.startsWith('bronze/')){
        const {schemaVersion,id,postId,rawHash,inputHash,ingestedAt,rightsStatus,...input}=value;
        if(rightsStatus!=='UNKNOWN'||hash(value.rawPayload)!==rawHash||hash(input)!==inputHash||hash({postId,inputHash})!==id||key!=='bronze/'+id+'.json')throw Error('DATA_INTEGRITY_ERROR: '+key);
      }
      return value;
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      if(/^DATA_(SCHEMA|INTEGRITY)/.test(e.message||''))throw e;
      throw Error('DATA_STORAGE_CORRUPT: ' + key);
    }
  }
  async write(key: string, value: unknown, immutable = false) {
    const file = this.file(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (immutable) {
      const old = await this.read(key);
      if (old) {
        if (JSON.stringify(old) !== JSON.stringify(value))
          throw Error('IMMUTABLE_BRONZE_CONFLICT');
        return;
      }
    }
    const temp = file + '.' + randomUUID() + '.tmp',
      handle = await fs.open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(temp, file);
  }
  async *rows<T>(kind: 'posts' | 'runs' | 'production-jobs' | 'crawler-runs' | 'gold-shadows' | 'gold-feedback' | 'conversation-runs' | 'thread-collections' | 'thread-replies' | 'conversation-feedback' | 'editorial-plans') {
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(this.root, kind));
    } catch (e: any) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const f of entries.sort())
      if (/^[a-f0-9]{64}\.json$/.test(f)) {
        const row = await this.read<T>(kind + '/' + f);
        if (row) yield row;
      }
  }
}
