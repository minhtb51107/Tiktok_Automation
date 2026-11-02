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
}
export function labelledCounts(
  controls: { label: string; text: string }[],
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
        names.some((n) => n.toLowerCase() === c.label.trim().toLowerCase()),
      );
      if (matches.length !== 1)
        return [
          key,
          {
            status: matches.length ? 'UNVERIFIED' : 'UNAVAILABLE',
            value: null,
            raw: null,
            source: 'exact target DOM labelled control',
          },
        ];
      const control = matches[0];
      const raw = control.text.replace(control.label, '').trim();
      if (!raw)
        return [
          key,
          {
            status: 'NOT_PRESENT',
            value: null,
            raw: '',
            source: 'DOM svg/title=' + control.label,
          },
        ];
      const m = raw.match(/^([\d.,]+)\s*([KMB])?$/i);
      let value: number | null = null;
      if (m) {
        const compact = !!m[2];
        const numeric = compact
          ? Number(m[1].replace(',', '.'))
          : Number(m[1].replace(/[.,]/g, ''));
        value = Number.isFinite(numeric)
          ? Math.round(
              numeric *
                ({ K: 1000, M: 1000000, B: 1000000000 }[m[2]?.toUpperCase()] ||
                  1),
            )
          : null;
      }
      return [
        key,
        {
          status: value === null ? 'UNVERIFIED' : 'AVAILABLE',
          value,
          raw,
          source: 'DOM svg/title=' + control.label,
          approximate: !!m?.[2],
        },
      ];
    }),
  );
}
