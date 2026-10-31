import { describe, it, expect } from '@jest/globals';
import { matchExactTarget } from './target-identity';
describe('exact Threads identity', () => {
  it('matches ID, never matching text prefixes or neighboring replies', () => {
    const target = { permalink: '/@target/post/Exact_ID', text: 'same prefix' };
    expect(
      matchExactTarget('https://www.threads.com/@target/post/Exact_ID?x=1', [
        { permalink: '/@other/post/Other_ID', text: 'same prefix' },
        target,
      ]),
    ).toBe(target);
    expect(
      matchExactTarget('https://www.threads.com/@target/post/Missing', [
        target,
      ]),
    ).toBeUndefined();
    expect(
      matchExactTarget('https://www.threads.com/@target/post/Exact_ID', [
        target,
        { ...target },
      ]),
    ).toBeUndefined();
  });
});
