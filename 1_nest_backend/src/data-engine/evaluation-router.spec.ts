import { describe, expect, test } from '@jest/globals';
import {
  corroboratedRootTopic,
  durationPlans,
  EVALUATION_VERSION,
  routeEvaluation,
  validateRootTopic,
} from './evaluation-router';

const evidence = {
  sourceId: 'reply',
  hardBlockers: [],
  heuristicScore: 100,
  signals: { verified: true },
  uncertaintyReasons: ['UNCERTAIN_EDITORIAL_VALUE'],
  policyVersion: EVALUATION_VERSION,
};
const body = (length: number, prefix: string) =>
  Array.from({ length }, (_, i) => prefix + i).join(' ');

describe('cascaded editorial decisions', () => {
  test('deterministic routing gives hard blockers precedence over cache and provider', () => {
    const invalid = { ...evidence, hardBlockers: ['PARENT_EVIDENCE_REQUIRED'] };
    expect(
      routeEvaluation(invalid, { validated: 'ACCEPT', cached: true }),
    ).toMatchObject({ decision: 'REJECT', providerRequired: false });
    const shadow = routeEvaluation(evidence);
    expect(shadow).toEqual(routeEvaluation(evidence));
    expect(shadow).toMatchObject({
      decision: 'ESCALATE_LLM',
      providerRequired: true,
    });
    expect(
      routeEvaluation(evidence, { validated: 'ACCEPT', cached: true }),
    ).toMatchObject({
      decision: 'ACCEPT',
      providerRequired: false,
      reasons: ['EXACT_VALIDATED_CACHE'],
    });
    expect(
      routeEvaluation(evidence, { providerAvailable: false }),
    ).toMatchObject({ decision: 'WAITING_HUMAN', providerRequired: false });
  });

  test('topic matching requires corroboration and rejects fabricated semantic quotes', () => {
    const topic = 'kinh nghiệm đi làm';
    expect(
      corroboratedRootTopic(
        'Có kinh nghiệm đi làm. Hãy gợi ý học bổng.',
        topic,
        null,
      ),
    ).toBe(false);
    expect(
      corroboratedRootTopic(
        'Chưa có kinh nghiệm thực tế. Ngày đầu đi làm cần chuẩn bị gì?',
        topic,
        null,
      ),
    ).toBe(true);
    const text = 'Tôi kể chuyện ngày đầu đi làm.';
    expect(() =>
      validateRootTopic(
        {
          sourceId: 'root',
          verdict: 'RELEVANT',
          reason: 'Evidence',
          quotes: ['quote not in source'],
        },
        'root',
        text,
      ),
    ).toThrow('AI_SCHEMA_ROOT_TOPIC');
    expect(() =>
      validateRootTopic(
        {
          sourceId: 'other',
          verdict: 'RELEVANT',
          reason: 'Evidence',
          quotes: ['ngày đầu đi làm'],
        },
        'root',
        text,
      ),
    ).toThrow('AI_SCHEMA_ROOT_TOPIC');
    expect(
      validateRootTopic(
        {
          sourceId: 'root',
          verdict: 'RELEVANT',
          reason: 'Evidence',
          quotes: ['ngày đầu đi làm'],
        },
        'root',
        text,
      ).verdict,
    ).toBe('RELEVANT');
  });

  test('enumerates only feasible coherent subsets using immutable inputs', () => {
    const root = { id: 'root', text: body(145, 'root'), score: 0 };
    const replies = [
      { id: 'child', parentId: 'parent', text: body(95, 'child'), score: 91 },
      { id: 'parent', parentId: 'root', text: body(80, 'parent'), score: 76 },
      {
        id: 'duplicate',
        parentId: 'root',
        text: body(80, 'parent'),
        score: 65,
      },
      { id: 'extra', parentId: 'root', text: body(310, 'extra'), score: 10 },
    ];
    const plans = durationPlans(root, replies, 1.3);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans).toEqual(durationPlans(root, replies, 1.3));
    expect(
      plans.some(
        (plan) => plan.ids.includes('child') && !plan.ids.includes('parent'),
      ),
    ).toBe(false);
    expect(
      plans.some(
        (plan) => plan.ids.includes('parent') && plan.ids.includes('duplicate'),
      ),
    ).toBe(false);
    expect(plans.some((plan) => plan.ids.join(',') === 'parent,child')).toBe(
      true,
    );
    expect(plans.some((plan) => plan.ids.includes('extra'))).toBe(false);
    expect(replies[0].id).toBe('child');
  });
});
