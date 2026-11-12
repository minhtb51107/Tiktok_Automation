export type Availability =
  | 'AVAILABLE'
  | 'NOT_PRESENT'
  | 'UNAVAILABLE'
  | 'UNVERIFIED';
export interface ObservedField {
  status: Availability;
  value: string | number | null;
  raw: string | null;
  source: string;
  approximate?: boolean;
  normalized?: number | null;
  observedAt?: string;
}
export function parseInteractionValue(
  value: string,
): { raw: string; normalized: number; approximate: boolean } | null {
  const m = value.trim().match(/([\d]+(?:[.,][\d]+)*)\s*([KMB])?/i);
  if (!m) return null;
  const suffix = m[2]?.toUpperCase(),
    compact = !!suffix;
  const numeric = compact
    ? Number(m[1].replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'))
    : Number(m[1].replace(/[.,]/g, ''));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return {
    raw: m[1] + (suffix || ''),
    normalized: Math.round(
      numeric * ({ K: 1_000, M: 1_000_000, B: 1_000_000_000 }[suffix!] || 1),
    ),
    approximate: compact,
  };
}
/** Never attribute controls from a container with mixed/unknown post identities. */
export function contextLabelledCounts(
  controls: { label: string; text: string }[],
  identityCount: number | undefined,
  observedAt?: string,
) {
  const fields = labelledCounts(
    identityCount === 1 ? controls : [],
    observedAt,
  );
  for (const field of Object.values(fields))
    field.source =
      'context DOM labelled control; single permalink identity required';
  return fields;
}
export function labelledCounts(
  controls: { label: string; text: string }[],
  observedAt?: string,
): Record<string, ObservedField> {
  const labels: Record<string, string[]> = {
    likeCount: ['Thích', 'Like', 'Unlike', 'Bỏ thích'],
    replyCount: ['Bình luận', 'Reply', 'Comment'],
    repostCount: ['Đăng lại', 'Repost'],
    shareCount: ['Chia sẻ', 'Share'],
  };
  return Object.fromEntries(
    Object.entries(labels).map(([key, names]) => {
      const matches = controls.filter((c) =>
        names.some((n) => {
          const label = c.label.trim().toLowerCase(),
            needle = n.toLowerCase();
          return (
            label === needle ||
            label.startsWith(needle + ' ') ||
            label.endsWith(' ' + needle) ||
            label.includes(' ' + needle + ' ') ||
            label.includes('lượt ' + needle)
          );
        }),
      );
      if (matches.length !== 1)
        return [
          key,
          {
            status: matches.length ? 'UNVERIFIED' : 'UNAVAILABLE',
            value: null,
            raw: null,
            source: 'exact target DOM labelled control',
            observedAt,
          },
        ];
      const control = matches[0];
      const stripped = names
        .reduce(
          (value, name) => value.replace(new RegExp(name, 'giu'), ''),
          control.text,
        )
        .trim();
      const parsed =
        parseInteractionValue(stripped) ||
        parseInteractionValue(control.text) ||
        parseInteractionValue(control.label);
      if (!parsed)
        return [
          key,
          {
            status:
              stripped && stripped !== control.label.trim()
                ? 'UNVERIFIED'
                : 'NOT_PRESENT',
            value: null,
            raw: '',
            source: 'DOM labelled control action=' + names[0],
            observedAt,
          },
        ];
      return [
        key,
        {
          status: 'AVAILABLE',
          value: parsed.normalized,
          normalized: parsed.normalized,
          raw: parsed.raw,
          source: 'DOM labelled control action=' + names[0],
          approximate: parsed.approximate,
          observedAt,
        },
      ];
    }),
  );
}
