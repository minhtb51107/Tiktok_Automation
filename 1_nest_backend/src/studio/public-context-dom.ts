/** Self-contained public DOM observation. No order/author/topic/distance parent heuristic. */
export function observePublicContext() {
  const observedAt = new Date().toISOString();
  const nodePath = (element: Element | null) => {
    const segments: string[] = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const testId = node.getAttribute('data-testid'),
        role = node.getAttribute('role');
      segments.unshift(
        `${node.tagName.toLowerCase()}${testId ? `[data-testid="${testId}"]` : ''}${role ? `[role="${role}"]` : ''}`,
      );
      if (segments.length === 8) break;
    }
    return '/' + segments.join('/');
  };
  const canonical = (value: string) => {
    try {
      const u = new URL(value, location.origin);
      return u.protocol === 'https:' &&
        !u.port &&
        !u.username &&
        !u.password &&
        [
          'threads.com',
          'www.threads.com',
          'threads.net',
          'www.threads.net',
        ].includes(u.hostname) &&
        /^\/@[\w.-]+\/post\/[\w-]+\/?$/.test(u.pathname)
        ? 'https://www.threads.com' + u.pathname.replace(/\/$/, '')
        : null;
    } catch {
      return null;
    }
  };
  const target = canonical(location.href),
    regions: Array<{
      kind: 'DISCUSSION_REGION' | 'RECOMMENDATION_REGION';
      documentUrl: string;
      targetUrl: string;
      subjectUrl: string;
      label: string;
      pointer: string;
      observedAt?: string;
      cardNodeIdentity?: string;
      parentContainerPath?: string;
      conversationContainerPointer?: string;
    }> = [],
    replies: Array<{
      subjectUrl: string;
      parentUrl: string;
      documentUrl: string;
      authorUrl: string;
      bodyText: string;
      pointer: string;
      label: string;
      subjectTimePermalink: string;
      headerScoped: true;
      observedAt?: string;
      cardNodeIdentity?: string;
      parentContainerPath?: string;
      conversationContainerPointer?: string;
      rawSignal?: { label: string; href: string };
    }> = [];
  if (!target) return { regions, replies };
  const cards = [
    ...document.querySelectorAll(
      'div[data-pressable-container="true"],article',
    ),
  ]
    .filter((c) => {
      const b = c.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    })
    .slice(0, 80);
  cards.forEach((card, index) => {
    const owns = (el: Element) =>
      el.closest('div[data-pressable-container="true"],article') === card;
    const times = [
      ...new Set(
        [...card.querySelectorAll('time')]
          .filter(owns)
          .map((t) =>
            canonical(t.closest('a[href]')?.getAttribute('href') || ''),
          )
          .filter(Boolean),
      ),
    ];
    const all = [
      ...new Set(
        [...card.querySelectorAll('a[href]')]
          .filter(owns)
          .map((a) => canonical(a.getAttribute('href') || ''))
          .filter(Boolean),
      ),
    ];
    const subject =
      times.length === 1 ? times[0] : all.length === 1 ? all[0] : null;
    if (!subject || subject === target) return;
    for (
      let region = card.parentElement;
      region && region !== document.body;
      region = region.parentElement
    ) {
      if (!region.matches('section,[role="region"],[data-testid]')) continue;
      const accessible = (
        region.getAttribute('aria-label') ||
        (region.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ')
      ).trim();
      const testId = (region.getAttribute('data-testid') || '').trim();
      const label = accessible || testId;
      const recommended =
        /^(suggested posts|related posts|more posts|bài viết (đề xuất|liên quan|khác))$/iu.test(
          accessible,
        ) ||
        /^(suggested|related|recommended)[-_]?(posts?|feed|section)$/iu.test(
          testId,
        );
      const discussion =
        (/^(replies|comments|discussion|bình luận|trả lời|cuộc thảo luận)$/iu.test(
          accessible,
        ) ||
          /^(thread[-_])?(replies|comments|conversation|discussion)([-_]section)?$/iu.test(
            testId,
          )) &&
        [...region.querySelectorAll('a[href]')].some(
          (a) => canonical(a.getAttribute('href') || '') === target,
        );
      if (recommended || discussion) {
        regions.push({
          kind: recommended ? 'RECOMMENDATION_REGION' : 'DISCUSSION_REGION',
          documentUrl: target,
          targetUrl: target,
          subjectUrl: subject,
          label,
          pointer: `/dom/card/${index}/explicit-region`,
          observedAt,
          cardNodeIdentity: nodePath(card),
          parentContainerPath: nodePath(card.parentElement),
          conversationContainerPointer: nodePath(region),
        });
        break;
      }
    }
    // A body link saying "Replying to" is NOT UI evidence. Require the card's header.
    if (times.length !== 1) return;
    const targets = [
      ...card.querySelectorAll(
        'header a[href],[data-testid="reply-context"] a[href],[data-testid="replying-to"] a[href]',
      ),
    ].filter(
      (a) =>
        owns(a) &&
        /^(replying to|đang trả lời)(?:\s+@[\w.-]+)?$/iu.test(
          (a.getAttribute('aria-label') || a.textContent || '').trim(),
        ),
    );
    if (targets.length !== 1) return;
    const parent = canonical(targets[0].getAttribute('href') || '');
    if (!parent || parent === subject) return;
    const handle = subject.split('/')[3];
    const author = [...card.querySelectorAll('header a[href],a[rel="author"]')]
      .filter(owns)
      .map((a) => {
        try {
          const u = new URL(a.getAttribute('href') || '', location.origin);
          return u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            !u.port &&
            [
              'threads.com',
              'www.threads.com',
              'threads.net',
              'www.threads.net',
            ].includes(u.hostname) &&
            u.pathname.replace(/\/$/, '') === '/' + handle
            ? 'https://www.threads.com/' + handle
            : null;
        } catch {
          return null;
        }
      })
      .find(Boolean);
    if (!author) return;
    const text = [...card.querySelectorAll('span[dir="auto"]')]
      .filter(
        (s) =>
          owns(s) &&
          !s.closest(
            'header,time,button,[role="button"],[data-testid="reply-context"],[data-testid="replying-to"]',
          ) &&
          !s.parentElement?.closest('span[dir="auto"]'),
      )
      .map((s) => s.textContent || '')
      .filter(Boolean)
      .join('\n');
    if (text.trim())
      replies.push({
        subjectUrl: subject,
        parentUrl: parent,
        documentUrl: target,
        authorUrl: author,
        bodyText: text,
        pointer: `/dom/card/${index}/header/reply-link`,
        label: (
          targets[0].getAttribute('aria-label') ||
          targets[0].textContent ||
          ''
        ).trim(),
        subjectTimePermalink: subject,
        headerScoped: true,
        observedAt,
        cardNodeIdentity: nodePath(card),
        parentContainerPath: nodePath(card.parentElement),
        conversationContainerPointer: nodePath(
          card.closest('section,[role="region"],[data-testid]'),
        ),
        rawSignal: {
          label: (
            targets[0].getAttribute('aria-label') ||
            targets[0].textContent ||
            ''
          ).trim(),
          href: targets[0].getAttribute('href') || '',
        },
      });
  });
  return { regions, replies };
}

/** One bounded, non-mutating discovery action. It never clicks engagement/composer controls. */
export function performPublicConversationAction(input: {
  actionId: string;
  allowReplyExpansion: boolean;
}) {
  const documentHeightBefore = document.documentElement.scrollHeight;
  const nodePath = (element: Element | null) => {
    const segments: string[] = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const testId = node.getAttribute('data-testid'),
        role = node.getAttribute('role');
      segments.unshift(
        `${node.tagName.toLowerCase()}${testId ? `[data-testid="${testId}"]` : ''}${role ? `[role="${role}"]` : ''}`,
      );
      if (segments.length === 8) break;
    }
    return '/' + segments.join('/');
  };
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    return (
      box.width > 0 &&
      box.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    );
  };
  if (input.allowReplyExpansion) {
    const candidates = [
      ...document.querySelectorAll('button,[role="button"]'),
    ]
      .filter(visible)
      .map((element) => ({
        element: element as HTMLElement,
        label: (
          element.getAttribute('aria-label') ||
          element.textContent ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim(),
      }))
      .filter(({ label }) => {
        if (/^(reply|trả lời)$/iu.test(label)) return false;
        return (
          /\b(view|show|see|load)\b.*\b(repl(?:y|ies))\b/iu.test(label) ||
          /\b(xem|hiển thị|tải)\b.*\b(trả lời)\b/iu.test(label)
        );
      });
    if (candidates.length) {
      const selected = candidates[0],
        card = selected.element.closest(
          'div[data-pressable-container="true"],article',
        ),
        kind = /\b(more|all|load|thêm|tất cả)\b/iu.test(selected.label)
          ? ('LOAD_MORE' as const)
          : ('EXPAND_NESTED' as const);
      selected.element.click();
      return {
        actionId: input.actionId,
        kind,
        label: selected.label,
        containerIdentity: nodePath(card || selected.element.parentElement),
        documentHeightBefore,
      };
    }
  }
  const before = window.scrollY;
  window.scrollBy({ top: Math.max(window.innerHeight * 0.85, 480), behavior: 'auto' });
  return {
    actionId: input.actionId,
    kind: 'SCROLL' as const,
    label: null,
    containerIdentity: null,
    documentHeightBefore,
    scrollChanged: window.scrollY !== before,
  };
}

/** Exact-permalink fallback. It records only an explicit public reply target on the subject card. */
export function observePermalinkParentEvidence(expectedRootUrl: string) {
  const canonical = (value: string) => {
    try {
      const url = new URL(value, location.origin),
        match = url.pathname.match(/^\/@([\w.-]+)\/post\/([\w-]+)\/?$/);
      return url.protocol === 'https:' &&
        !url.port &&
        !url.username &&
        !url.password &&
        ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(
          url.hostname,
        ) &&
        match
        ? `https://www.threads.com/@${match[1]}/post/${match[2]}`
        : null;
    } catch {
      return null;
    }
  };
  const subject = canonical(location.href),
    root = canonical(expectedRootUrl),
    observedAt = new Date().toISOString();
  if (!subject || !root)
    return { status: 'INVALID_DETAIL_IDENTITY' as const, candidate: null };
  const cards = [
    ...document.querySelectorAll('div[data-pressable-container="true"],article'),
  ].filter((card) => {
    const owns = (element: Element) =>
      element.closest('div[data-pressable-container="true"],article') === card;
    return [...card.querySelectorAll('time')]
      .filter(owns)
      .some(
        (time) =>
          canonical(time.closest('a[href]')?.getAttribute('href') || '') ===
          subject,
      );
  });
  if (cards.length !== 1)
    return { status: 'EXACT_SUBJECT_CARD_NOT_UNIQUE' as const, candidate: null };
  const card = cards[0],
    owns = (element: Element) =>
      element.closest('div[data-pressable-container="true"],article') === card,
    targets = [
      ...card.querySelectorAll(
        'header a[href],[data-testid="reply-context"] a[href],[data-testid="replying-to"] a[href]',
      ),
    ].filter(
      (anchor) =>
        owns(anchor) &&
        /^(replying to|đang trả lời)(?:\s+@[\w.-]+)?$/iu.test(
          (anchor.getAttribute('aria-label') || anchor.textContent || '').trim(),
        ),
    );
  if (targets.length !== 1)
    return { status: 'NO_PUBLIC_PARENT_EVIDENCE' as const, candidate: null };
  const parentUrl = canonical(targets[0].getAttribute('href') || ''),
    handle = subject.split('/')[3],
    authorUrl = [...card.querySelectorAll('header a[href],a[rel="author"]')]
      .filter(owns)
      .map((anchor) => canonicalProfile(anchor.getAttribute('href') || ''))
      .find((url) => url === `https://www.threads.com/${handle}`),
    bodyText = [...card.querySelectorAll('span[dir="auto"]')]
      .filter(
        (span) =>
          owns(span) &&
          !span.closest(
            'header,time,button,[role="button"],[data-testid="reply-context"],[data-testid="replying-to"]',
          ) &&
          !span.parentElement?.closest('span[dir="auto"]'),
      )
      .map((span) => (span.textContent || '').trim())
      .filter(Boolean)
      .join('\n');
  if (!parentUrl || !authorUrl || !bodyText)
    return { status: 'INCOMPLETE_EXPLICIT_PARENT_EVIDENCE' as const, candidate: null };
  return {
    status: 'EXPLICIT_PARENT_OBSERVED' as const,
    candidate: {
      kind: 'PERMALINK_DETAIL_PARENT' as const,
      rootUrl: root,
      subjectUrl: subject,
      parentUrl,
      documentUrl: subject,
      authorUrl,
      bodyText,
      pointer: '/dom/exact-subject/header/reply-target',
      observedAt,
      label: (
        targets[0].getAttribute('aria-label') ||
        targets[0].textContent ||
        ''
      ).trim(),
      subjectPermalink: subject,
      publishedAt:
        card.querySelector('time[datetime]')?.getAttribute('datetime') || null,
    },
  };
  function canonicalProfile(value: string) {
    try {
      const url = new URL(value, location.origin),
        match = url.pathname.match(/^\/@([\w.-]+)\/?$/);
      return url.protocol === 'https:' &&
        !url.port &&
        !url.username &&
        !url.password &&
        ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(
          url.hostname,
        ) &&
        match
        ? `https://www.threads.com/@${match[1]}`
        : null;
    } catch {
      return null;
    }
  }
}
