import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DATA_SCHEMA,
  type Bronze,
  type SourceInput,
  type Evaluation,
} from './contracts';
import { DATA_CONFIG } from './config';
import * as rules from './rules';
import { DataEngine } from './engine';
import { DataStore } from './store';
import { savedSessionInputs } from './studio-adapter';
jest.setTimeout(30000);
const asOf = '2026-11-02T00:00:00.000Z',
  body =
    'TEST DATA. Mình chia sẻ kinh nghiệm công việc trong công ty. Những người mới đi làm có gặp khó khăn khi trao đổi với đồng nghiệp không? Đây là một câu chuyện về cách học hỏi và tìm được công việc phù hợp với bản thân.';
const roots: string[] = [];
function input(id = 'TEST001', text = body): SourceInput {
  return {
    sourcePlatform: 'THREADS',
    sourcePostId: id,
    sourceUrl: 'https://www.threads.com/@test_data/post/' + id,
    author: {
      name: 'SYNTHETIC TEST DATA',
      handle: 'test_data',
      avatarUrl: null,
    },
    originalBody: text,
    topic: null,
    itemType: 'POST',
    parentReference: null,
    publishedAt: '2026-11-01T00:00:00.000Z',
    fetchedAt: '2026-11-01T01:00:00.000Z',
    engagement: { likes: 10, replies: null, reposts: null, shares: null },
    fetch: { source: 'SYNTHETIC_UNIT_TEST', query: null },
    rawPayload: { text, synthetic: true },
    provenance: { synthetic: true },
  };
}
function bronze(patch: Partial<SourceInput> = {}): Bronze {
  const x = { ...input(), ...patch };
  return {
    ...x,
    schemaVersion: DATA_SCHEMA,
    id: rules.hash(x),
    postId: rules.hash(x.sourcePostId),
    rawHash: rules.hash(x.rawPayload),
    inputHash: rules.hash(x),
    rightsStatus: 'UNKNOWN',
    ingestedAt: asOf,
  };
}
async function engine() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'data01-test-'));
  roots.push(dir);
  return new DataEngine(new DataStore(dir), DATA_CONFIG, () => asOf);
}
afterEach(async () => {
  jest.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      !path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) ||
      !path.basename(root).startsWith('data01-test-')
    )
      throw Error('Unsafe test cleanup path');
    await fs.rm(root, { recursive: true, force: true });
  }
});
describe('DATA-01 validation — SYNTHETIC TEST DATA', () => {
  it.each([
    [{ sourcePostId: null }, 'INVALID_SOURCE_ID'],
    [{ sourcePostId: 'bad id' }, 'INVALID_SOURCE_ID'],
    [{ sourceUrl: 'http://127.0.0.1/private' }, 'MALFORMED_CANONICAL_URL'],
    [{ sourcePostId: 'DIFFERENT' }, 'SOURCE_ID_MISMATCH'],
    [{ publishedAt: '2026-02-30T00:00:00Z' }, 'INVALID_PUBLISHED_AT'],
    [{ fetchedAt: null }, 'INVALID_FETCHED_AT'],
    [{ originalBody: '  ' }, 'EMPTY_CONTENT'],
    [
      { author: { name: null, handle: null, avatarUrl: null } },
      'MISSING_AUTHOR',
    ],
    [
      { engagement: { likes: -1, replies: null, reposts: null, shares: null } },
      'INVALID_ENGAGEMENT_LIKES',
    ],
    [{ itemType: 'UNSUPPORTED' }, 'UNSUPPORTED_ITEM_STRUCTURE'],
    [{ rawPayload: [] }, 'UNSUPPORTED_RAW_STRUCTURE'],
    [
      {
        originalBody:
          'This is the story and you have the right to share your ideas with the world.',
      },
      'UNSUPPORTED_LANGUAGE',
    ],
  ] as [any, string][])('quarantines %j', (patch, reason) => {
    const s = rules.validate(bronze(patch));
    expect(s.status).toBe('QUARANTINED');
    expect(s.quarantineReasons).toContain(reason);
  });
  it('keeps missing engagement null and unknown type/date as review flags, not fake values', () => {
    const b = bronze({
        engagement: { likes: null, replies: null, reposts: null, shares: null },
        itemType: 'UNKNOWN',
        publishedAt: null,
      }),
      s = rules.validate(b),
      g = rules.evaluate(b, s, asOf);
    expect(s.status).toBe('VALIDATED');
    expect(s.flags).toContain('UNKNOWN_ENTITY_TYPE');
    expect(g.eligibility).toBe('NEEDS_REVIEW');
    expect(b.engagement.likes).toBeNull();
    expect(g.breakdown.engagement.reason).toContain('Unknown');
  });
  it('normalizes Vietnamese NFC/case/whitespace only, preserving accents, numbers and slang', () => {
    expect(rules.normalize('  CÔNG  TY\nở Việt Nam '.normalize('NFD'))).toBe(
      'công ty ở việt nam',
    );
    expect(rules.normalize('t clm cmn TOEIC 700 N4')).toBe(
      't clm cmn toeic 700 n4',
    );
    expect(rules.normalize('ma')).not.toBe(rules.normalize('má'));
  });
  it('uses an evidenced body mapping without changing original source, not a guessed first line', () => {
    const b = bronze({
        originalBody: 'công việc tphcm\n' + body,
        provenance: {
          synthetic: true,
          bodyMapping: {
            body,
            topic: 'công việc tphcm',
            evidence: 'TEST DATA: exact DOM topic evidence',
            sourceUrl: input().sourceUrl!,
          },
        },
      }),
      before = JSON.stringify(b),
      s = rules.validate(b);
    expect(s.normalized.body).toBe(rules.normalize(body));
    expect(s.normalized.topic).toBe('công việc tphcm');
    expect(JSON.stringify(b)).toBe(before);
    b.provenance.bodyMapping!.sourceUrl =
      'https://www.threads.com/@other/post/WRONG';
    expect(rules.validate(b).normalized.body).toContain('công việc tphcm');
  });
});
describe('DATA-01 rules, scoring and deduplication — SYNTHETIC TEST DATA', () => {
  it('does not reject a first-person experience quoting a recruitment advertisement',()=>{
    const b=bronze({originalBody:'TEST DATA. Tôi chia sẻ trải nghiệm công ty cần tuyển nhân viên, mức lương ghi rất cao nhưng gửi CV xong không được trả lời. Liên hệ hotline cũng không giúp ích.'});
    const g=rules.evaluate(b,rules.validate(b),asOf);expect(g.labels).not.toContain('ADVERTISEMENT');expect(g.eligibility).toBe('NEEDS_REVIEW');
  });
  it('does not classify work/TOEIC/salary experience as advertising without combined intent', () => {
    const b = bronze({
        originalBody:
          body +
          ' Công ty tuyển dụng người có TOEIC nhưng tôi thấy mức lương không phù hợp.',
      }),
      s = rules.validate(b),
      g = rules.evaluate(b, s, asOf);
    expect(g.labels).not.toContain('ADVERTISEMENT');
    expect(g.eligibility).toBe('ELIGIBLE');
    const ad = bronze({
      originalBody:
        'TEST DATA. Công ty cần tuyển nhân viên. Mức lương hấp dẫn, gửi CV và liên hệ hotline để ứng tuyển.',
    });
    expect(rules.evaluate(ad, rules.validate(ad), asOf).labels).toContain(
      'ADVERTISEMENT',
    );
  });
  it('routes ambiguity and policy keywords to reversible review, not permanent deletion', () => {
    const b = bronze({ originalBody: body + ' clm cmn' }),
      g = rules.evaluate(b, rules.validate(b), asOf);
    expect(g.eligibility).toBe('NEEDS_REVIEW');
    expect(g.labels).toContain('POLICY_RISK');
  });
  it('has a measured near-duplicate threshold and does not equate shared topics', () => {
    expect(
      rules.similarity(body, body + ' Ghi chú thêm.'),
    ).toBeGreaterThanOrEqual(DATA_CONFIG.nearDuplicate.threshold);
    expect(
      rules.similarity(
        body,
        'TEST DATA. Công việc và công ty đang thay đổi mức lương. Chúng tôi nghiên cứu thị trường để hiểu nhu cầu tuyển dụng tại địa phương.',
      ),
    ).toBeLessThan(DATA_CONFIG.nearDuplicate.threshold);
    expect(rules.similarity('công ty', 'công ty')).toBe(0);
  });
  it('reproduces score/breakdown with pinned config/asOf and exposes the full weighted sum', () => {
    const b = bronze(),
      s = rules.validate(b),
      one = rules.evaluate(b, s, asOf);
    expect(rules.evaluate(b, s, asOf)).toEqual(one);
    expect(one.score).toBeCloseTo(
      Object.values(one.breakdown).reduce((sum, x) => sum + x.contribution, 0),
    );
    expect(one.score).toBeGreaterThanOrEqual(65);
    expect(one.silverId).toBe(s.id);
  });
  it('Precision@10 requires all ten ground-truth labels, never fabricates negatives', () => {
    const ranked = Array.from({ length: 10 }, (_, n) => 'TEST' + n),
      truth = Object.fromEntries(ranked.map((id, n) => [id, n < 7]));
    expect(rules.precisionAt10(ranked, truth)).toMatchObject({
      status: 'MEASURED',
      value: 0.7,
    });
    delete truth.TEST9;
    expect(rules.precisionAt10(ranked, truth).status).toBe('NOT_MEASURED');
    expect(rules.precisionAt10(ranked.slice(0, 5), {}).status).toBe(
      'NOT_MEASURED',
    );
  });
});
describe('DATA-01 durable integration — local files, no API/model/database', () => {
  it('deduplicates a later repaired source against a previously valid source, without self-duplicate updates',async()=>{
    const e=await engine();await e.import([{...input('TEST001'),publishedAt:'INVALID'},input('TEST002')],asOf);
    const fixed=await e.import([{...input('TEST001'),fetchedAt:'2026-11-01T02:00:00.000Z'}],asOf),d=await e.detail(fixed.results[0].postId);expect(d.evaluation!.silver!.duplicate?.kind).toBe('EXACT');
    const updated=await e.import([{...input('TEST002'),fetchedAt:'2026-11-01T03:00:00.000Z',engagement:{...input().engagement,likes:33}}],asOf),keeper=await e.detail(updated.results[0].postId);expect(keeper.evaluation!.silver!.duplicate).toBeNull();
  });
  it('retains historical evaluation references and rejects raw-source tampering',async()=>{
    const e=await engine(),a=input();await e.import([a],asOf);const first=await e.catalog(),old=await e.detail(first.rows[0].id);
    await e.import([{...a,fetchedAt:'2026-11-01T02:00:00.000Z',engagement:{...a.engagement,likes:99}}],asOf);
    const current=await e.detail(old.post.id);expect(current.post.evaluationIds).toHaveLength(2);expect((await e.history(old.post.id,old.evaluation!.id))!.gold).toEqual(old.evaluation!.gold);
    const file=path.join(e.store.root,'bronze',current.bronze!.id+'.json'),b=JSON.parse(await fs.readFile(file,'utf8'));b.originalBody='TEST DATA tampering';await fs.writeFile(file,JSON.stringify(b));await expect(e.detail(old.post.id)).rejects.toThrow('DATA_INTEGRITY_ERROR');
  });
  it('imports twice without new posts/observations/transitions and preserves raw bytes/fields', async () => {
    const e = await engine(),
      source = input(),
      original = JSON.stringify(source),
      a = await e.import([source], asOf),
      b = await e.import([source], asOf);
    expect(a.status).toBe('COMPLETED');
    expect(b).toHaveProperty('reused', true);
    const catalog = await e.catalog(),
      d = await e.detail(catalog.rows[0].id);
    expect(catalog.total).toBe(1);
    expect(catalog.observations).toBe(1);
    expect(JSON.stringify(source)).toBe(original);
    expect(d.bronze!.originalBody).toBe(source.originalBody);
    expect(d.bronze!.rawPayload).toEqual(source.rawPayload);
    expect(d.bronze!.rightsStatus).toBe('UNKNOWN');
    expect(d.evaluation!.transitions.map((t) => t.to)).toEqual([
      'DISCOVERED',
      'VALIDATED',
      'ELIGIBLE',
      'SCORED',
      'QUALIFIED',
    ]);
  });
  it('retains engagement observations of one source ID without duplicating the post', async () => {
    const e = await engine(),
      a = input(),
      b = {
        ...a,
        fetchedAt: '2026-11-01T02:00:00.000Z',
        engagement: { ...a.engagement, likes: 99 },
      };
    await e.import([a], asOf);
    await e.import([b], asOf);
    const c = await e.catalog(),
      d = await e.detail(c.rows[0].id);
    expect(c.total).toBe(1);
    expect(c.observations).toBe(2);
    expect(d.bronze!.engagement.likes).toBe(99);
    const original = await e.observation(d.post.id, d.post.observations[0]);
    expect(original!.engagement.likes).toBe(10);
  });
  it('quarantines malformed observation but retains and processes an out-of-order historic snapshot', async () => {
    const e = await engine(),
      a = input();
    await e.import([a], asOf);
    const historical = {
      ...a,
      fetchedAt: '2026-10-31T02:00:00.000Z',
      publishedAt: 'INVALID',
    };
    const r = await e.import([historical], asOf);
    expect(r.results[0].state).toBe('QUARANTINED');
    const d = await e.detail(r.results[0].postId);
    expect(d.bronze!.fetchedAt).toBe(a.fetchedAt);
    expect(d.evaluation!.state).toBe('QUALIFIED');
  });
  it('marks exact duplicates but never merges different source identities; near copy remains reviewable', async () => {
    const e = await engine();
    await e.import(
      [
        input('TEST001'),
        input('TEST002'),
        input('TEST003', body + ' Ghi chú thêm.'),
      ],
      asOf,
    );
    const c = await e.catalog();
    expect(c.total).toBe(3);
    const ds = await Promise.all(c.rows.map((r) => e.detail(r.id)));
    expect(
      ds.filter((d) => d.evaluation!.silver!.duplicate?.kind === 'EXACT'),
    ).toHaveLength(1);
    const near = ds.find(
      (d) => d.evaluation!.silver!.duplicate?.kind === 'NEAR',
    )!;
    expect(near.evaluation!.gold!.eligibility).toBe('NEEDS_REVIEW');
    expect(near.evaluation!.state).toBe('SCORED');
  });
  it('recovers after a saved scoring checkpoint in a new engine without repeating valid stages', async () => {
    const e = await engine(),
      spy = jest.spyOn(rules, 'evaluate'),
      write = e.store.write.bind(e.store);
    let fail = true;
    jest.spyOn(e.store, 'write').mockImplementation(async (k, v, immutable) => {
      await write(k, v, immutable);
      if (fail && (v as Evaluation).state === 'SCORED') {
        fail = false;
        throw Error('TEST DATA injected interruption after durable score');
      }
    });
    const first = await e.import([input()], asOf);
    expect(first.status).toBe('FAILED');
    expect(first.cursor).toBe(0);
    const restored = new DataEngine(
        new DataStore(e.store.root),
        DATA_CONFIG,
        () => asOf,
      ),
      result = await restored.resume(first.id);
    expect(result.status).toBe('COMPLETED');
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await restored.catalog()).total).toBe(1);
    const d = await restored.detail(result.results[0].postId);
    expect(
      d.evaluation!.transitions.filter((t) => t.to === 'VALIDATED'),
    ).toHaveLength(1);
    expect(d.evaluation!.transitions.some((t) => t.to === 'FAILED')).toBe(true);
  });
  it('resumes a process-left RUNNING manifest and concurrent imports remain idempotent', async () => {
    const e = await engine();
    const [a, b] = await Promise.all([
      e.import([input()], asOf),
      e.import([input()], asOf),
    ]);
    expect(a.id).toBe(b.id);
    const run = await e.store.read<any>('runs/' + a.id + '.json');
    run.status = 'RUNNING';
    run.cursor = 0;
    run.results = [];
    await e.store.write('runs/' + a.id + '.json', run);
    const restored = new DataEngine(
      new DataStore(e.store.root),
      DATA_CONFIG,
      () => asOf,
    );
    expect((await restored.resume(a.id)).status).toBe('COMPLETED');
    expect((await restored.catalog()).observations).toBe(1);
  });
  it('manual review uses optimistic revision, cannot bypass quarantine, and queue is DRAFT only', async () => {
    const e = await engine(),
      source = { ...input(), itemType: 'UNKNOWN' as const };
    const run = await e.import([source], asOf);
    let d = await e.detail(run.results[0].postId);
    expect(d.evaluation!.state).toBe('SCORED');
    await expect(e.enqueue(d.post.id, d.evaluation!.revision)).rejects.toThrow(
      'qualified',
    );
    await expect(
      e.review(d.post.id, 0, 'ACCEPT', 'TEST DATA review', 'POST'),
    ).rejects.toThrow('STALE');
    await expect(
      e.review(d.post.id, d.evaluation!.revision, 'ACCEPT', 'TEST DATA review'),
    ).rejects.toThrow('Confirm target');
    d = await e.review(
      d.post.id,
      d.evaluation!.revision,
      'ACCEPT',
      'TEST DATA reviewed; not a real approval',
      'POST',
    );
    const queued = await e.enqueue(d.post.id, d.evaluation!.revision);
    expect(queued).toMatchObject({
      queue: { mode: 'DRAFT_ONLY' },
      candidate: { style: 'SERIOUS' },
      rightsStatus: 'UNKNOWN',
      publishingAllowed: false,
    });
    expect((await e.detail(d.post.id)).bronze!.itemType).toBe('UNKNOWN');
    const bad = await e.import(
        [{ ...input('BAD001'), originalBody: '' }],
        asOf,
      ),
      bd = await e.detail(bad.results[0].postId);
    await expect(
      e.review(
        bd.post.id,
        bd.evaluation!.revision,
        'ACCEPT',
        'TEST DATA',
        'POST',
      ),
    ).rejects.toThrow('validation');
  });
  it('Studio adapter reads raw targets, not edited text or unrelated context', () => {
    const p: any = {
      id: 'TEST-SESSION',
      revision: 1,
      project: { style: 'SERIOUS' },
      items: [
        {
          id: 'TEST-ITEM',
          selected: true,
          sourceUrl: input().sourceUrl,
          originalText: body,
          displayText: 'EDITED DISPLAY',
          spokenText: 'EDITED SPOKEN',
          author: { displayName: 'TEST DATA' },
          rawExtraction: { text: body, type: 'UNKNOWN' },
          inclusion: 'TARGET',
        },
        { id: 'context', selected: true, inclusion: 'EXPLICIT_CONTEXT' },
      ],
      sourceRun: { completedAt: asOf },
      attempts: [],
    };
    const before = JSON.stringify(p),
      rows = savedSessionInputs(p);
    expect(rows).toHaveLength(1);
    expect(rows[0].originalBody).toBe(body);
    expect(JSON.stringify(p)).toBe(before);
    expect(JSON.stringify(rows)).not.toContain('EDITED SPOKEN');
  });
});
