import {
  drivePublicConversation,
  conversationBudget,
  mergeConversationSnapshots,
  observePublicDocument,
  stripObservedTimestampChrome,
} from './conversation-public';
import {
  observePublicContext,
  performPublicConversationAction,
} from '../studio/public-context-dom';
import { describe, expect, jest, test } from '@jest/globals';

const target = 'https://www.threads.com/@root/post/ROOT';
const row = (id: string, text: string, action: string | null = null) => ({
  urls: [`https://www.threads.com/@author/post/${id}`],
  subjectUrl: `https://www.threads.com/@author/post/${id}`,
  authorHandle: 'author',
  controls: [],
  date: '2026-11-15T00:00:00.000Z',
  text,
  rawText: text,
  media: [],
  pointer: `/dom/card/${id}`,
  nodeIdentity: `/article/${id}`,
  parentContainerPath: '/main',
  conversationContainer: null,
  relationshipSignals: [],
  observedActionId: action,
  capturedAt: '2026-11-15T00:00:00.000Z',
});
const observed = (rows: ReturnType<typeof row>[]) => ({
  rows,
  jsonLd: [],
  diagnostics: {
    cards: rows.length,
    permalinkAnchors: rows.length,
    materializedCards: rows.filter((value) => value.text).length,
    subjectPermalinks: rows.length,
    explicitNoResults: false,
  },
});
const context = { regions: [], replies: [] };

describe('browser-driven conversation acquisition', () => {
  test('validates configurable deep-collection budgets without changing emergency guards',()=>{
    expect(conversationBudget({maxDurationMs:90000,maxActions:15,maxCards:100,maxRequestEvents:300,maxUnchangedActions:3,maxPermalinkValidations:2})).toMatchObject({maxDurationMs:90000,maxActions:15,maxCards:100});
    expect(()=>conversationBudget({maxActions:16})).toThrow('CONVERSATION_INVALID_COLLECTION_BUDGET');
  });
  test('removes date chrome from the clean body but does not alter raw evidence', () => {
    const input = row('A', '06/10/2026\nNội dung thật\nDòng thứ hai');
    input.rawText = 'author\n06/10/2026\nNội dung thật\nDòng thứ hai\n86\n14';
    const merged = mergeConversationSnapshots([
      {
        actionId: 'initial',
        at: '2026-11-15T00:00:00.000Z',
        observed: observed([input]),
        context,
      },
    ]);
    expect(merged.rows[0].text).toBe('Nội dung thật\nDòng thứ hai');
    expect(merged.rows[0].rawText).toBe(input.rawText);
    expect(
      stripObservedTimestampChrome('Không có ngày trong nội dung', input.date),
    ).toBe('Không có ngày trong nội dung');
  });

  test('merges snapshots by exact subject and retains the fullest owned body', () => {
    const merged = mergeConversationSnapshots([
      {
        actionId: 'initial',
        at: '2026-11-15T00:00:00.000Z',
        observed: observed([row('A', 'short')]),
        context,
      },
      {
        actionId: 'action-1',
        at: '2026-11-15T00:00:01.000Z',
        observed: observed([
          row('A', 'complete first paragraph\ncomplete second paragraph'),
          row('B', 'another card'),
        ]),
        context,
      },
    ]);
    expect(merged.rows).toHaveLength(2);
    expect(merged.rows.find((value) => value.subjectUrl?.endsWith('/A'))).toMatchObject({
      text: 'complete first paragraph\ncomplete second paragraph',
      observedActionId: 'action-1',
    });
    expect(merged.diagnostics).toMatchObject({
      subjectPermalinks: 2,
      materializedCards: 2,
    });
  });

  test('records bounded user-like actions without asserting a parent edge', async () => {
    const snapshots = [
      observed([row('A', 'one')]),
      observed([row('A', 'one'), row('B', 'two')]),
      observed([row('A', 'one'), row('B', 'two')]),
    ];
    let observedIndex = 0,
      actionIndex = 0;
    const page = {
      url: () => target,
      evaluate: jest.fn(async (fn: unknown) => {
        if (fn === observePublicDocument)
          return snapshots[Math.min(observedIndex++, snapshots.length - 1)];
        if (fn === observePublicContext) return context;
        if (fn === performPublicConversationAction) {
          actionIndex++;
          return {
            actionId: `action-${actionIndex}`,
            kind: actionIndex === 1 ? 'EXPAND_NESTED' : 'SCROLL',
            label: actionIndex === 1 ? 'View 2 replies' : null,
            containerIdentity: actionIndex === 1 ? '/article/A' : null,
            documentHeightBefore: 1000,
          };
        }
        throw Error('UNEXPECTED_EVALUATE');
      }),
      waitForFunction: jest.fn(async () => true),
    } as any;
    const result = await drivePublicConversation(page, target, 2);
    expect(result.trace.actions).toEqual([
      expect.objectContaining({ kind: 'EXPAND_NESTED', changed: true }),
      expect.objectContaining({ kind: 'SCROLL', changed: false }),
    ]);
    expect(result.observed.rows).toHaveLength(2);
    expect(result.context.replies).toEqual([]);
    expect(result.trace.transitions.some((entry) => entry.state === 'EXPANDING_NESTED')).toBe(true);
  });

  test('continues bounded scrolling until bottom fold before counting unchanged pagination actions', async () => {
    const snapshots = [
      observed([row('A', 'one')]),
      observed([row('A', 'one')]),
      observed([row('A', 'one')]),
      observed([row('A', 'one'), row('B', 'loaded at bottom')]),
      observed([row('A', 'one'), row('B', 'loaded at bottom')]),
      observed([row('A', 'one'), row('B', 'loaded at bottom')]),
    ];
    let observedIndex = 0,
      actionIndex = 0;
    const page = {
      url: () => target,
      evaluate: jest.fn(async (fn: unknown) => {
        if (fn === observePublicDocument)
          return snapshots[Math.min(observedIndex++, snapshots.length - 1)];
        if (fn === observePublicContext) return context;
        if (fn === performPublicConversationAction) {
          actionIndex++;
          return {
            actionId: `action-${actionIndex}`,
            kind: 'SCROLL',
            label: null,
            containerIdentity: null,
            containerSubjectUrl: null,
            documentHeightBefore: 5000,
            scrollChanged: actionIndex <= 3,
            reachedBottom: actionIndex >= 3,
          };
        }
        throw Error('UNEXPECTED_EVALUATE');
      }),
      waitForFunction: jest.fn(async () => true),
    } as any;
    const result = await drivePublicConversation(page, target, 6, undefined, {
      maxUnchangedActions: 2,
    });
    expect(result.observed.rows.map((r) => r.text)).toEqual([
      'one',
      'loaded at bottom',
    ]);
    expect(result.trace.actions.length).toBe(5);
  });
});
