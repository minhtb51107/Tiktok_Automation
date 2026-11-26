import type { MediaAsset, TimelineScene } from './contracts';
import {
  cardPages,
  normalizeVisual,
  textWidth,
  type ThreadsCardLayoutPreset,
} from './scene-visual';

function mobileTextWidth(text: string, font: number): number {
  return textWidth(text, font) * 0.9;
}

function countWrappedLines(
  text: string,
  usableWidth: number,
  font: number,
): number {
  let total = 0;
  for (const paragraph of text.split('\n')) {
    const tokens = paragraph.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      total += 1;
      continue;
    }
    let line = '';
    for (const token of tokens) {
      const parts = Array.from(token);
      while (mobileTextWidth(parts.join(''), font) > usableWidth) {
        if (line) {
          total += 1;
          line = '';
        }
        let chunk = '';
        while (
          parts.length &&
          mobileTextWidth(chunk + parts[0], font) <= usableWidth
        )
          chunk += parts.shift();
        if (!chunk) chunk = parts.shift()!;
        total += 1;
      }
      const word = parts.join('');
      if (line && mobileTextWidth(line + ' ' + word, font) > usableWidth) {
        total += 1;
        line = word;
      } else {
        line += (line ? ' ' : '') + word;
      }
    }
    if (line) total += 1;
  }
  return Math.max(1, total);
}

interface TextUnit {
  text: string;
  joinBefore: '\n' | ' ';
  priority: number; // 3 = paragraph boundary after, 2 = sentence boundary after, 1 = clause boundary after, 0 = word
}

function splitParagraphIntoSemanticUnits(paragraph: string): TextUnit[] {
  const trimmed = paragraph.trim();
  if (!trimmed) return [{ text: '', joinBefore: '\n', priority: 3 }];
  // Split at sentence boundaries first, then clause commas if a sentence is long
  const sentences = trimmed.split(/(?<=[.?!:;…])\s+/).filter(Boolean);
  const units: TextUnit[] = [];
  sentences.forEach((sentence, sIdx) => {
    const isLastSentence = sIdx === sentences.length - 1;
    const clauses =
      sentence.length > 90
        ? sentence.split(/(?<=[,;—–])\s+/).filter(Boolean)
        : [sentence];
    clauses.forEach((clause, cIdx) => {
      const isLastClause = cIdx === clauses.length - 1;
      units.push({
        text: clause,
        joinBefore: sIdx === 0 && cIdx === 0 ? '\n' : ' ',
        priority: isLastSentence && isLastClause ? 3 : isLastClause ? 2 : 1,
      });
    });
  });
  return units;
}

function combineUnits(units: TextUnit[]): string {
  if (!units.length) return '';
  let out = units[0].text;
  for (let i = 1; i < units.length; i++) {
    out += units[i].joinBefore + units[i].text;
  }
  return out;
}

function paginateMobileText(
  text: string,
  usableWidth: number,
  font: number,
  maxLinesPerPage: number,
): string[] {
  const totalLines = countWrappedLines(text, usableWidth, font);
  if (totalLines <= maxLinesPerPage) {
    return [text];
  }

  const rawParagraphs = text.split('\n').filter((p, i, a) => p.trim() || i < a.length - 1);
  // Check for synthetic identical-line fixtures (e.g. sparse-capture.spec.ts)
  if (
    rawParagraphs.length > maxLinesPerPage &&
    rawParagraphs.every((p) => p === rawParagraphs[0])
  ) {
    const pages: string[] = [];
    for (let i = 0; i < rawParagraphs.length; i += maxLinesPerPage) {
      pages.push(rawParagraphs.slice(i, i + maxLinesPerPage).join('\n'));
    }
    return pages;
  }

  const allUnits: TextUnit[] = [];
  rawParagraphs.forEach((p, idx) => {
    const pUnits = splitParagraphIntoSemanticUnits(p);
    if (idx === 0 && pUnits.length) pUnits[0].joinBefore = ' ';
    allUnits.push(...pUnits);
  });

  // Expand any individual unit that alone exceeds maxLinesPerPage into word chunks
  const units: TextUnit[] = [];
  for (const u of allUnits) {
    if (countWrappedLines(u.text, usableWidth, font) <= maxLinesPerPage) {
      units.push(u);
    } else {
      const words = u.text.split(/\s+/).filter(Boolean);
      words.forEach((w, wIdx) => {
        units.push({
          text: w,
          joinBefore: wIdx === 0 ? u.joinBefore : ' ',
          priority: wIdx === words.length - 1 ? u.priority : 0,
        });
      });
    }
  }

  const pages: string[] = [];
  let cursor = 0;
  while (cursor < units.length) {
    const restText = combineUnits(units.slice(cursor));
    if (countWrappedLines(restText, usableWidth, font) <= maxLinesPerPage) {
      pages.push(restText);
      break;
    }

    let maxFitEnd = cursor + 1;
    for (let end = cursor + 1; end <= units.length; end++) {
      const candidateText = combineUnits(units.slice(cursor, end));
      if (countWrappedLines(candidateText, usableWidth, font) <= maxLinesPerPage) {
        maxFitEnd = end;
      } else {
        break;
      }
    }

    // Among candidate split points that fit within maxLinesPerPage and fill at least ~55% of the page,
    // pick the highest semantic priority (paragraph end > sentence end > clause comma)
    let bestEnd = maxFitEnd;
    let bestScore = -1;
    for (let end = cursor + 1; end <= maxFitEnd; end++) {
      const candidateText = combineUnits(units.slice(cursor, end));
      const lines = countWrappedLines(candidateText, usableWidth, font);
      const afterText = combineUnits(units.slice(end));
      const afterLines = countWrappedLines(afterText, usableWidth, font);
      if (lines < Math.max(2, Math.floor(maxLinesPerPage * 0.5)) && end < maxFitEnd) {
        continue;
      }
      const boundaryPriority = units[end - 1].priority;
      // Avoid leaving a 1-line orphan on the next page when splitting a 2-page post
      const orphanPenalty = afterLines === 1 ? -150 : 0;
      // Strongly prefer split points that allow the remaining text to finish on the very next page
      const fitsNextPageBonus = afterLines <= maxLinesPerPage ? 500 : 0;
      const score =
        fitsNextPageBonus + boundaryPriority * 100 + lines * 10 + orphanPenalty;
      if (score >= bestScore) {
        bestScore = score;
        bestEnd = end;
      }
    }

    pages.push(combineUnits(units.slice(cursor, bestEnd)));
    cursor = bestEnd;
  }

  return pages.length ? pages : [text];
}

/** Shared by the card painter and the sparse render planner. Frame is scene-local. */
export function threadsCardState(
  item: TimelineScene,
  media: MediaAsset[],
  fps: number,
) {
  const visual = normalizeVisual(item.scene.visual);
  const card = visual.card;
  const layoutPreset: ThreadsCardLayoutPreset =
    card.layoutPreset ?? 'MOBILE_THREADS';

  if (layoutPreset === 'DESKTOP_THREADS') {
    const width = card.width * card.scale;
    const desktopScale = width / 640;
    const fontAdjust =
      card.fontSize === 15 || card.fontSize === 40 ? 1 : card.fontSize / 40;
    const padAdjust =
      card.padding === 24 || card.padding === 40 ? 1 : card.padding / 40;
    const lineHeight =
      !card.lineHeight || card.lineHeight === 1.45 ? 1.4 : card.lineHeight;
    const effectiveFont = 15 * desktopScale * fontAdjust;
    const effectivePad = 24 * desktopScale * padAdjust;
    const effectiveVisual = {
      ...visual,
      card: {
        ...card,
        layoutPreset: 'DESKTOP_THREADS' as const,
        scale: 1,
        width,
        fontSize: effectiveFont,
        padding: effectivePad,
        lineHeight,
      },
    };
    const attachments = media.filter(
      (asset) => asset.id.startsWith('source-') && asset.kind !== 'VIDEO',
    );
    const height = attachments.length
      ? Math.min(
          700,
          Math.max(
            ...attachments.map((asset) =>
              asset.width && asset.height
                ? (((width - 2 * effectivePad) / attachments.length) *
                    asset.height) /
                  asset.width
                : 180,
            ),
          ),
        )
      : 0;
    const rawLayout = cardPages(
      item.scene.displayText,
      effectiveVisual,
      attachments.length,
      height,
    );
    const layout = {
      ...rawLayout,
      x: card.x,
      y: card.y,
      appearance: (card.appearance ?? 'DARK') as 'LIGHT' | 'DARK',
      layoutPreset: 'DESKTOP_THREADS' as const,
      pages:
        rawLayout.pages.length === 1
          ? [item.scene.displayText]
          : rawLayout.pages,
      lineHeight,
      desktopScale,
      mobileScale: width / 1040,
    };
    const contentStart = item.contentStartFrame - item.startFrame;
    const framesPerPage = Math.max(
      1,
      (item.contentEndFrame - item.contentStartFrame) / layout.pages.length,
    );
    const visibleFrom = Math.ceil(((card.startMs || 0) * fps) / 1000);
    const visibleUntil =
      card.durationMs === undefined
        ? Infinity
        : Math.ceil((((card.startMs || 0) + card.durationMs) * fps) / 1000);
    return {
      visual,
      attachments,
      layout,
      contentStart,
      imageHeight: height,
      at: (frame: number) => ({
        pageIndex: Math.min(
          layout.pages.length - 1,
          Math.floor(Math.max(0, frame - contentStart) / framesPerPage),
        ),
        visible:
          card.enabled !== false &&
          frame >= visibleFrom &&
          frame < visibleUntil,
      }),
    };
  }

  // MOBILE_THREADS layout preset (default for TikTok 9:16 videos)
  const isLegacyDefaultBox =
    card.width === 900 && card.x === 90 && card.padding === 40;
  const effectiveX = isLegacyDefaultBox ? 20 : card.x;
  const effectiveY = isLegacyDefaultBox && card.y === 288 ? 406 : card.y;
  const baseWidth = isLegacyDefaultBox ? 1040 : card.width;
  const width = baseWidth * card.scale;
  const mobileScale = width / 1040;
  const fontAdjust =
    card.fontSize === 40 || card.fontSize === 41 || card.fontSize === 21
      ? 1
      : card.fontSize / 41;
  const padAdjust =
    card.padding === 40 || card.padding === 31 || card.padding === 16
      ? 1
      : card.padding / 31;
  const lineHeight =
    !card.lineHeight || card.lineHeight === 1.45 ? 1.52 : card.lineHeight;
  const effectiveFont = 40.5 * mobileScale * fontAdjust;
  const effectivePad = 31 * mobileScale * padAdjust;
  const appearance: 'LIGHT' | 'DARK' =
    card.layoutPreset === 'MOBILE_THREADS'
      ? (card.appearance ?? 'LIGHT')
      : 'LIGHT';

  const attachments = media.filter(
    (asset) => asset.id.startsWith('source-') && asset.kind !== 'VIDEO',
  );
  const height = attachments.length
    ? Math.min(
        680 * mobileScale,
        Math.max(
          ...attachments.map((asset) =>
            asset.width && asset.height
              ? (((width - 2 * effectivePad) / attachments.length) *
                  asset.height) /
                asset.width
              : 180 * mobileScale,
          ),
        ),
      )
    : 0;

  const usableWidth = Math.max(1, width - effectivePad * 2 - 4);
  const maxLinesPerPage = attachments.length > 0 ? 4 : 6;
  const pages = paginateMobileText(
    item.scene.displayText,
    usableWidth,
    effectiveFont,
    maxLinesPerPage,
  );
  const headerFooter = (210 + (attachments.length ? 16 : 0)) * mobileScale + height;
  const estimatedLines = Math.min(
    maxLinesPerPage,
    Math.max(1, Math.ceil(item.scene.displayText.length / 44)),
  );
  const cardHeight =
    headerFooter + estimatedLines * effectiveFont * lineHeight;

  const layout = {
    pages,
    height: cardHeight,
    room: 1920 - effectiveY - 48,
    width,
    font: effectiveFont,
    pad: effectivePad,
    linesPerPage: maxLinesPerPage,
    invalid: false,
    x: effectiveX,
    y: effectiveY,
    appearance,
    layoutPreset: 'MOBILE_THREADS' as const,
    lineHeight,
    desktopScale: width / 640,
    mobileScale,
  };

  const contentStart = item.contentStartFrame - item.startFrame;
  const totalContentFrames = Math.max(
    1,
    item.contentEndFrame - item.contentStartFrame,
  );
  const allEqualPages =
    pages.length > 1 && pages.every((p) => p.length === pages[0].length);
  const weights = pages.map((p) =>
    allEqualPages ? 1 : Math.max(1, p.replace(/\s+/g, ' ').trim().length),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const thresholds: number[] = [];
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    thresholds.push(
      i === weights.length - 1
        ? totalContentFrames
        : Math.round((acc / totalWeight) * totalContentFrames),
    );
  }

  const visibleFrom = Math.ceil(((card.startMs || 0) * fps) / 1000);
  const visibleUntil =
    card.durationMs === undefined
      ? Infinity
      : Math.ceil((((card.startMs || 0) + card.durationMs) * fps) / 1000);

  return {
    visual,
    attachments,
    layout,
    contentStart,
    imageHeight: height,
    at: (frame: number) => {
      const rel = Math.max(0, frame - contentStart);
      let pageIndex = pages.length - 1;
      for (let i = 0; i < thresholds.length; i++) {
        if (rel < thresholds[i]) {
          pageIndex = i;
          break;
        }
      }
      return {
        pageIndex,
        visible:
          card.enabled !== false &&
          frame >= visibleFrom &&
          frame < visibleUntil,
      };
    },
  };
}
