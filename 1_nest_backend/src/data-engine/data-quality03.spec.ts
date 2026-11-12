import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  ConversationReview,
  ThreadCollection,
} from './conversation-contracts';
import { observedContextViews } from './conversation-context';
import { StudioService } from '../studio/studio.service';

const captureFile =
  process.env.DATA_QUALITY03_CAPTURE ||
  path.resolve(
    __dirname,
    '../../.studio-data/reports/data-quality02-live-smoke01/collection.json',
  );
const replay = existsSync(captureFile) ? test : test.skip;

describe('DATA-QUALITY-03 — saved LIVE replay, no network', () => {
  replay(
    'merges 10 materialized cards and 26 observations by canonical permalink without loss or duplication',
    () => {
      const bytes = readFileSync(captureFile),
        collection = JSON.parse(bytes.toString()) as ThreadCollection;
      const rows = observedContextViews(collection);
      expect(collection.sourceCapture?.contextCandidates).toHaveLength(10);
      expect(collection.unverified).toHaveLength(26);
      expect(rows).toHaveLength(26);
      expect(new Set(rows.map((x) => x.url)).size).toBe(26);
      expect(
        rows.filter(
          (x) =>
            x.raw.provenance.text !==
            'persisted target-page observation; parent unavailable',
        ),
      ).toHaveLength(10);
      expect(
        rows.every(
          (x) => x.originalText.trim() && x.displayText.trim() && x.selectable,
        ),
      ).toBe(true);
      expect(
        rows.every((x) =>
          [
            'OBSERVED_RELATIONSHIP_UNVERIFIED',
            'RELATED_OR_RECOMMENDED',
            'UNKNOWN',
          ].includes(x.relationship),
        ),
      ).toBe(true);
      expect(rows.find((x) => x.author === 'tuan27020')?.relationship).toBe(
        'RELATED_OR_RECOMMENDED',
      );
      expect(
        createHash('sha256').update(readFileSync(captureFile)).digest('hex'),
      ).toBe(createHash('sha256').update(bytes).digest('hex'));
    },
  );

  replay(
    'explicit observed selection creates a reopenable Script DRAFT while preserving raw/original and evidence',
    async () => {
      const collection = JSON.parse(
        readFileSync(captureFile, 'utf8'),
      ) as ThreadCollection;
      const rows = observedContextViews(collection),
        chosen =
          rows.find((x) => x.author === 'myhao1103') ??
          rows.find((x) => x.relationship !== 'RELATED_OR_RECOMMENDED')!;
      const review: ConversationReview = {
        schemaVersion: 'threads-data/1',
        collectionId: 'saved-live-replay',
        revision: 1,
        selectedReplyIds: [],
        selectedObservedUrls: [chosen.url],
        replyLabels: {},
        decision: 'NEEDS_REVIEW',
        reason: 'TEST DATA explicit editorial selection',
        history: [],
      };
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dq03-studio-')),
        service = new StudioService({} as any);
      Object.assign(service, { root: dir });
      try {
        const draft = await service.createConversationDraft(collection, review),
          reopened = await service.load(draft.id);
        expect(reopened.derivedFrom).toBe('conversation:saved-live-replay');
        expect(reopened.items).toHaveLength(27);
        expect(reopened.items.filter((x) => x.selected)).toHaveLength(2);
        const item = reopened.items.find((x) => x.sourceUrl === chosen.url)!;
        expect(item.selected).toBe(true);
        expect(item.originalText).toBe(chosen.originalText);
        expect(item.displayText).toBe(chosen.displayText);
        expect(item.rawExtraction).toEqual(chosen.raw);
        expect(item.observationEvidence).toMatchObject({
          level: 'OBSERVED_ON_TARGET_PAGE',
          targetUrl: collection.root.url,
          parentId: null,
        });
        expect(item.manualLocks).toEqual([]);
        expect(
          reopened.items.find((x) => x.author.handle === 'tuan27020')?.selected,
        ).toBe(false);
        expect(
          reopened.project.comments.every(
            (x) => x.relationshipStatus !== 'PARENT_VERIFIED',
          ),
        ).toBe(true);
      } finally {
        if (
          path.dirname(dir) !== path.resolve(os.tmpdir()) ||
          !path.basename(dir).startsWith('dq03-studio-')
        )
          throw Error('UNSAFE_TEST_CLEANUP');
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    20000,
  );
});
