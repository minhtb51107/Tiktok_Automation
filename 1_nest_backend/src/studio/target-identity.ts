export const targetId = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return (
      new URL(url, 'https://www.threads.com').pathname.match(
        /^\/@[\w.-]+\/post\/([\w-]+)\/?$/,
      )?.[1] || null
    );
  } catch {
    return null;
  }
};
export function matchExactTarget<T extends { permalink: string | null }>(
  canonicalUrl: string | null,
  rows: readonly T[],
): T | undefined {
  const id = targetId(canonicalUrl);
  if (!id) return undefined;
  const matches = rows.filter((row) => targetId(row.permalink) === id);
  return matches.length === 1 ? matches[0] : undefined;
}
