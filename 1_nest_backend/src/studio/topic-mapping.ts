import type { StudioItem } from './studio.contracts';
import { offlineNormalize } from './offline-normalization';
export function splitTopicText(
  text: string,
  topic: string,
): { body: string; matched: boolean } {
  const lines = text.split(/\r?\n/),
    first = lines[0]?.trim();
  const clean = (s: string) =>
    s
      .normalize('NFC')
      .toLocaleLowerCase('vi')
      .replace(/[.。!?]+$/, '')
      .trim();
  const normalized = offlineNormalize({
    id: 'topic',
    revision: 0,
    originalText: topic,
    spokenText: topic,
  }).proposedSpokenText;
  if (
    lines.length > 1 &&
    [topic, normalized].some((t) => clean(first) === clean(t))
  )
    return { body: lines.slice(1).join('\n').trim(), matched: true };
  return { body: text, matched: false };
}
export function topicBody(item: StudioItem) {
  return (
    item.contentMapping?.bodyText ?? item.metadata?.bodyText ?? item.displayText
  );
}
