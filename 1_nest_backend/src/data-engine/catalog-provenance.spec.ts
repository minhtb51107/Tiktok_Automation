import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataEngine } from './engine';
import { DataStore } from './store';
import { DATA_CONFIG } from './config';
import type { SourceInput } from './contracts';
jest.setTimeout(30000);
const asOf = '2026-11-03T00:00:00.000Z';
const body =
  'SYNTHETIC TEST DATA. Mình chia sẻ kinh nghiệm công việc trong công ty. Những người mới đi làm có gặp khó khăn khi trao đổi với đồng nghiệp không? Đây là một câu chuyện về cách học hỏi và tìm được công việc phù hợp với bản thân mình.';
const input = (id: string, synthetic: boolean): SourceInput => ({
  sourcePlatform: 'THREADS',
  sourcePostId: id,
  sourceUrl: 'https://www.threads.com/@catalog_flag/post/' + id,
  author: { name: 'SYNTHETIC TEST DATA', handle: 'catalog_flag', avatarUrl: null },
  originalBody: body + ' ' + id,
  topic: null,
  itemType: 'POST',
  parentReference: null,
  publishedAt: '2026-11-01T00:00:00.000Z',
  fetchedAt: '2026-11-02T00:00:00.000Z',
  engagement: { likes: 5, replies: null, reposts: null, shares: null },
  fetch: { source: 'SYNTHETIC_UNIT_TEST', query: null },
  rawPayload: { id, synthetic },
  provenance: { synthetic },
});
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.basename(root).startsWith('data-catalog-flag-')) throw Error('Unsafe test cleanup path');
    await fs.rm(root, { recursive: true, force: true });
  }
});
describe('catalog provenance — SYNTHETIC TEST DATA', () => {
  it('exposes the synthetic flag per row so the UI never calls mock data REAL DATA', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'data-catalog-flag-'));
    roots.push(dir);
    const engine = new DataEngine(new DataStore(dir), DATA_CONFIG, () => asOf);
    await engine.import([input('FLAGSYN001', true), input('FLAGREAL001', false)], asOf);
    const rows = (await engine.catalog()).rows as { sourcePostId: string; synthetic: boolean }[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.sourcePostId === 'FLAGSYN001')?.synthetic).toBe(true);
    expect(rows.find((r) => r.sourcePostId === 'FLAGREAL001')?.synthetic).toBe(false);
    const catalog=await engine.catalog();
    expect(catalog.provenanceCounts).toEqual({REAL:0,SYNTHETIC:1,UNKNOWN:1});
    expect(catalog.reviewSummary.pending).toBe(2);
  });
});
