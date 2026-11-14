import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { DataStore } from './store';
import { DataEngine } from './engine';
import { ConversationEngine } from './conversation-engine';
import type { SourceAttempt } from '../studio/public-types';

describe('PRODUCT-DELIVERY capture bridge — isolated TEST DATA', () => {
  let dir = '';
  afterEach(async () => {
    if (dir && path.basename(dir).startsWith('product-capture-'))
      await rm(dir, { recursive: true, force: true });
  });
  it('imports one exact capture idempotently and keeps context unverified', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'product-capture-'));
    const engine = new ConversationEngine(new DataEngine(new DataStore(dir)), {
      execution: 'LIVE',
      discover: async () => [],
      enrich: async () => {
        throw Error('NO_NETWORK_IN_TEST');
      },
    });
    const root = 'https://www.threads.com/@root/post/ROOT01',
      context = 'https://www.threads.com/@context/post/CONTEXT01',
      record = (url: string, text: string, author: string): any => ({
        url,
        text,
        bodyText: text,
        author,
        handle: new URL(url).pathname.split('/')[1].slice(1),
        avatar: null,
        createdAt: null,
        type: 'UNKNOWN',
        parentReference: null,
        media: [],
        likeCount: null,
        replyCount: null,
        repostCount: null,
        shareCount: null,
        provenance: { text: 'SYNTHETIC TEST DATA' },
      }),
      attempt: SourceAttempt = {
        originalUrl: root,
        resolvedUrl: root,
        canonicalUrl: root,
        status: 'PARTIAL',
        scope: 'WITH_CONTEXT',
        matchedTargetId: 'ROOT01',
        matchMethod: 'DOM_PERMALINK',
        elapsedMs: 1,
        diagnostics: [],
        redirects: [],
        records: [record(root, 'TEST DATA root', 'root')],
        contextCandidates: [record(context, 'TEST DATA observed context', 'context')],
        retrievedAt: '2026-11-14T00:00:00.000Z',
      };
    const first = await engine.importObservedCapture(attempt, 'product-job-1'),
      second = await engine.importObservedCapture(attempt, 'product-job-1'),
      saved = await engine.collection(first.results[0].collectionId);
    expect(second.id).toBe(first.id);
    expect(saved.collection.replies).toHaveLength(0);
    expect(saved.collection.unverified).toHaveLength(1);
    expect(saved.collection.unverified[0].observation?.level).toBe(
      'OBSERVED_ON_TARGET_PAGE',
    );
    expect(saved.collection.sourceCapture).toEqual(attempt);
    expect(saved.evaluation.precisionAt10.status).toBe('NOT_MEASURED');
  });
});
