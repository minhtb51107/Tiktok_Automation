import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ScraperService } from '../modules/core/scraper/scraper.service';
import type {
  VideoProject,
  SourceReference,
} from '../video-pipeline/contracts';
import type { StudioSession } from './studio.contracts';
import { sourceReport, reportMarkdown } from './stage-report';
import {
  extractPublicThreads,
  threadsUrl as validateThreadsUrl,
} from './public-threads';

export function threadsUrl(value: unknown): string {
  return validateThreadsUrl(value);
}
@Injectable()
export class StudioService {
  private root = path.resolve(process.cwd(), '.studio-data');
  private busy = false;
  private extract = extractPublicThreads;
  constructor(private readonly scraper: ScraperService) {}
  private file(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new BadRequestException('Invalid session ID');
    return path.join(this.root, id + '.json');
  }
  async load(id: string): Promise<StudioSession> {
    return JSON.parse(await fs.readFile(this.file(id), 'utf8'));
  }
  async list() {
    await fs.mkdir(this.root, { recursive: true });
    const rows: { id: string; title: string; updatedAt: string }[] = [];
    for (const f of await fs.readdir(this.root))
      if (/^[a-f0-9-]{36}\.json$/.test(f)) {
        const s = await this.load(f.slice(0, -5));
        rows.push({ id: s.id, title: s.title, updatedAt: s.updatedAt });
      }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private async persist(s: StudioSession) {
    s.updatedAt = new Date().toISOString();
    s.revision++;
    const report = sourceReport(s);
    s.reports = [
      ...(s.reports || []).filter(
        (r) => r.stageName !== 'SOURCE' || r.runId !== report.runId,
      ),
      report,
    ];
    await fs.mkdir(this.root, { recursive: true });
    const f = this.file(s.id);
    await fs.writeFile(f + '.tmp', JSON.stringify(s, null, 2));
    await fs.rename(f + '.tmp', f);
    return s;
  }
  private async exclusive<T>(fn: () => Promise<T>) {
    if (this.busy)
      throw new ConflictException(
        'Another source operation is running. Try again after it finishes.',
      );
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }
  async create() {
    const id = randomUUID();
    const project: VideoProject = {
      contractVersion: '1.0',
      id,
      style: 'SERIOUS',
      title: 'Untitled project',
      sources: [],
      posts: [],
      comments: [],
      candidates: [],
      storyboard: [],
      audioAssets: [],
      mediaAssets: [],
      publishing: {
        title: '',
        caption: '',
        hashtags: [],
        language: 'vi',
        manualApprovalRequired: true,
      },
    };
    return this.exclusive(() =>
      this.persist({
        id,
        title: project.title,
        revision: 0,
        updatedAt: '',
        status: 'IDLE',
        scope: 'TARGET_ONLY',
        errors: [],
        project,
        items: [],
      }),
    );
  }
  async mutate(id: string, body: any, fetchSource = false) {
    return this.exclusive(async () => {
      const s = await this.load(id);
      if (body?.revision !== s.revision)
        throw new ConflictException(
          'Session changed. Reopen it before saving.',
        );
      if (fetchSource) {
        const startedAt = new Date().toISOString();
        if (
          body.scope !== undefined &&
          !['TARGET_ONLY', 'WITH_CONTEXT'].includes(body.scope)
        )
          throw new BadRequestException('Invalid extraction scope');
        s.scope = body.scope || s.scope || 'TARGET_ONLY';
        if (
          !Array.isArray(body.urls) ||
          !body.urls.length ||
          body.urls.length > 5
        )
          throw new BadRequestException('Enter 1–5 Threads URLs');
        const urls = [...new Set<string>(body.urls.map(threadsUrl))];
        const start = Date.now();
        s.errors = [];
        for (const url of urls) {
          try {
            const attempt = await this.extract(url, s.scope);
            s.attempts = [
              ...(s.attempts || []).filter((x) => x.originalUrl !== url),
              attempt,
            ];
            if (attempt.records.length && attempt.matchedTargetId) {
              const canonical =
                attempt.canonicalUrl || attempt.resolvedUrl || url;
              if (
                !s.project.sources.some((x) => x.canonicalUrl === canonical)
              ) {
                const first = s.items.length;
                this.append(
                  s,
                  canonical,
                  attempt.records[0],
                  s.scope === 'WITH_CONTEXT' ? attempt.records.slice(1) : [],
                );
                s.items.slice(first).forEach((item, index) => {
                  item.inclusion = index === 0 ? 'TARGET' : 'EXPLICIT_CONTEXT';
                  const raw = attempt.records[index];
                  item.sourceUrl =
                    typeof raw.url === 'string' ? raw.url : canonical;
                  item.rawExtraction = structuredClone(raw);
                  item.metadata = structuredClone(raw);
                  item.author = {
                    displayName: raw.author,
                    ...(raw.handle ? { handle: raw.handle } : {}),
                    ...(raw.avatar ? { avatarUrl: raw.avatar } : {}),
                  };
                  item.mediaReferences = raw.media.map((m) => m.url);
                  const previous = s.archivedItems?.find(
                    (i) =>
                      i.sourceUrl === item.sourceUrl &&
                      i.author.displayName === raw.author,
                  );
                  if (previous) {
                    item.selected = previous.selected;
                    if (previous.manualLocks.length || previous.revision > 0) {
                      item.displayText = previous.displayText;
                      item.spokenText = previous.spokenText;
                      item.metadata = previous.metadata;
                      item.manualLocks = [...previous.manualLocks];
                      item.revision = previous.revision;
                    }
                  }
                });
              }
            }
            if (attempt.status === 'ERROR')
              s.errors.push(
                ...attempt.diagnostics
                  .filter((d) => d.code !== 'RESOLVED')
                  .map((d) => url + ': ' + d.message),
              );
          } catch (e) {
            s.errors.push(
              'Extraction failed for ' +
                url +
                ': ' +
                (e instanceof Error ? e.message : 'Unknown error') +
                '. Existing content is preserved.',
            );
          }
        }
        s.elapsedMs = Date.now() - start;
        s.sourceRun = {
          runId: randomUUID(),
          startedAt,
          completedAt: new Date().toISOString(),
          elapsedMs: s.elapsedMs,
        };
        s.status = s.errors.length
          ? 'ERROR'
          : s.attempts?.some((a) => a.status === 'PARTIAL')
            ? 'PARTIAL'
            : 'READY';
      } else if (body.addContext) {
        const attempt = s.attempts?.find(
          (a) => a.originalUrl === body.addContext.originalUrl,
        );
        const raw = attempt?.contextCandidates?.[body.addContext.index];
        if (!raw || typeof raw.url !== 'string')
          throw new BadRequestException('Context candidate not found');
        if (!s.items.some((i) => i.sourceUrl === raw.url)) {
          const first = s.items.length;
          this.append(s, threadsUrl(raw.url), raw, []);
          const item = s.items[first];
          item.inclusion = 'EXPLICIT_CONTEXT';
          item.rawExtraction = structuredClone(raw);
          item.metadata = structuredClone(raw);
          item.mediaReferences = raw.media.map((m) => m.url);
        }
      } else if (body.manual) {
        const { text, author, comments } = body.manual;
        if (
          typeof text !== 'string' ||
          !text.trim() ||
          text.length > 30000 ||
          typeof comments !== 'string' ||
          comments.length > 60000
        )
          throw new BadRequestException(
            'Provide post text and comments (one per line), within the size limit',
          );
        this.append(
          s,
          body.manual.url ? threadsUrl(body.manual.url) : '',
          {
            text,
            author:
              typeof author === 'string'
                ? author.slice(0, 150)
                : 'Manual source',
          },
          comments
            .split('\n')
            .filter((x) => x.trim())
            .map((text) => ({ text, author: 'Imported comment' })),
        );
        s.status = 'READY';
        s.errors = [];
      } else {
        if (
          typeof body.title !== 'string' ||
          !body.title.trim() ||
          body.title.length > 150 ||
          !Array.isArray(body.items) ||
          body.items.length !== s.items.length
        )
          throw new BadRequestException('Invalid project edits');
        const ids = new Set<string>();
        s.items = body.items.map((patch: any, order: number) => {
          const original = s.items.find((x) => x.id === patch.id);
          if (
            !original ||
            ids.has(patch.id) ||
            typeof patch.selected !== 'boolean' ||
            typeof patch.displayText !== 'string' ||
            typeof patch.spokenText !== 'string' ||
            patch.displayText.length > 30000 ||
            patch.spokenText.length > 30000
          )
            throw new BadRequestException('Invalid item edits');
          ids.add(patch.id);
          let metadata = original.metadata;
          if (
            patch.metadata &&
            original.metadata &&
            JSON.stringify(patch.metadata) !== JSON.stringify(original.metadata)
          ) {
            const p = patch.metadata;
            if (
              typeof p.author !== 'string' ||
              p.author.length > 150 ||
              !Array.isArray(p.media) ||
              p.media.length > 30 ||
              p.media.some(
                (m) =>
                  !m ||
                  !['IMAGE', 'VIDEO', 'GIF'].includes(m.kind) ||
                  typeof m.url !== 'string' ||
                  !/^https:\/\//.test(m.url),
              )
            )
              throw new BadRequestException('Invalid author/media metadata');
            const count = (value: unknown) =>
              typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= 0
                ? value
                : null;
            metadata = {
              ...original.metadata,
              author: p.author,
              handle: typeof p.handle === 'string' ? p.handle : null,
              avatar:
                typeof p.avatar === 'string' && p.avatar.startsWith('https://')
                  ? p.avatar
                  : null,
              media: p.media,
              createdAt: typeof p.createdAt === 'string' ? p.createdAt : null,
              type: ['POST', 'COMMENT', 'UNKNOWN'].includes(p.type)
                ? p.type
                : 'UNKNOWN',
              parentReference:
                typeof p.parentReference === 'string'
                  ? p.parentReference
                  : null,
              likeCount: count(p.likeCount),
              replyCount: count(p.replyCount),
              repostCount: count(p.repostCount),
              provenance: {
                ...original.metadata.provenance,
                manual: 'User correction; rawExtraction unchanged',
              },
            };
          }
          const changed =
            JSON.stringify(metadata) !== JSON.stringify(original.metadata) ||
            original.displayText !== patch.displayText ||
            original.spokenText !== patch.spokenText;
          return {
            ...original,
            metadata,
            ...(metadata
              ? {
                  author: {
                    displayName: metadata.author,
                    ...(metadata.handle ? { handle: metadata.handle } : {}),
                  },
                  mediaReferences: metadata.media.map((m) => m.url),
                }
              : {}),
            order,
            selected: patch.selected,
            displayText: patch.displayText,
            spokenText: patch.spokenText,
            revision: original.revision + (changed ? 1 : 0),
            manualLocks: changed
              ? ['DISPLAY_TEXT', 'NARRATION_TEXT']
              : original.manualLocks,
          };
        });
        s.title = body.title.trim();
        s.project.title = s.title;
      }
      s.project.candidates = s.items.map((i) => ({
        id: i.id,
        style: 'SERIOUS',
        sourceReferences: [i.sourceReference],
        status: i.selected ? 'SELECTED' : 'REJECTED',
        selectedBy: 'USER',
      }));
      return this.persist(s);
    });
  }
  async report(id: string) {
    const s = await this.load(id);
    const report = sourceReport(s);
    return { report, markdown: reportMarkdown(report) };
  }
  async exactCopy(id: string) {
    const old = await this.load(id);
    const created = await this.create();
    created.title = old.title + ' — exact targets';
    created.project.title = created.title;
    created.derivedFrom = old.id;
    created.archivedItems = structuredClone(old.items);
    await this.exclusive(() => this.persist(created));
    const urls = (old.attempts || []).map((a) => a.originalUrl);
    if (!urls.length) return created;
    if (urls.length > 5)
      throw new BadRequestException('Copy supports up to five input URLs');
    return this.mutate(
      created.id,
      { revision: created.revision, urls, scope: 'TARGET_ONLY' },
      true,
    );
  }
  private append(s: StudioSession, url: string, post: any, comments: any[]) {
    const sourceId = randomUUID(),
      postId = randomUUID();
    s.project.sources.push({
      id: sourceId,
      platform: 'THREADS',
      canonicalUrl: url,
      retrievedAt: new Date().toISOString(),
      synthetic: false,
    });
    const commentIds: string[] = [];
    [post, ...comments].forEach((raw, index) => {
      if (typeof raw.text !== 'string' || !raw.text.trim()) return;
      const id = index === 0 ? postId : randomUUID();
      const author = { displayName: String(raw.author || 'Unknown') };
      const ref: SourceReference = {
        entityType: index === 0 ? 'POST' : 'COMMENT',
        entityId: id,
      };
      s.items.push({
        inclusion: 'MANUAL',
        sourceId,
        rawExtraction: {
          text: raw.text,
          author: author.displayName,
          handle: null,
          avatar: null,
          createdAt: null,
          type: 'UNKNOWN',
          parentReference: null,
          media: [],
          likeCount: null,
          replyCount: null,
          repostCount: null,
          provenance: { text: 'manual import', type: 'unavailable' },
        },
        metadata: {
          text: raw.text,
          author: author.displayName,
          handle: null,
          avatar: null,
          createdAt: null,
          type: 'UNKNOWN',
          parentReference: null,
          media: [],
          likeCount: null,
          replyCount: null,
          repostCount: null,
          provenance: { text: 'manual import', type: 'unavailable' },
        },
        id,
        sourceReference: ref,
        sourceUrl: url,
        author,
        originalText: raw.text,
        spokenText: raw.text,
        displayText: raw.text,
        mediaReferences: [raw.avatar, raw.attachedImage].filter(
          (x) => typeof x === 'string' && x,
        ),
        selected: index === 0,
        order: s.items.length,
        revision: 0,
        manualLocks: [],
      });
      if (index === 0)
        s.project.posts.push({
          id,
          sourceId,
          author,
          text: raw.text,
          mediaAssetIds: [],
          commentIds,
        });
      else {
        commentIds.push(id);
        s.project.comments.push({
          id,
          sourceId,
          postId,
          author,
          text: raw.text,
          mediaAssetIds: [],
        });
      }
    });
  }
}
