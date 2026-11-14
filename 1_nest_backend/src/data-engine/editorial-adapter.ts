import type { StudioSession, StudioItem } from '../studio/studio.contracts';
import type { EditorialPlan } from './editorial-contracts';
import { editorSettings } from '../video-pipeline/editor-state';
import {sourceProvenance,combinedProvenance} from './studio-integration';
import { observedContextViews } from './conversation-context';
/** Extends the existing DATA03 seed, preserving root and reply identities separately from editorial scene IDs. */
export function editorialSession(
  s: StudioSession,
  plan: EditorialPlan,
): StudioSession {
  const root = plan.bundle.collection.root,
    original = s.items[0],
    observed = new Map(observedContextViews(plan.bundle.collection).map((row) => [row.id, row]));
  const provenance=combinedProvenance([
    sourceProvenance({sourceUrl:root.url,sourcePostId:root.id,provenance:{synthetic:root.provenance.synthetic,identityEvidence:root.provenance.method==='EXISTING_EXACT_TARGET_EXTRACTOR'?'DOM_PERMALINK':undefined}}),
    ...plan.selectedReplyIds.map(id=>{const r=plan.bundle.collection.replies.find(r=>r.id===id)!;return r.provenance.synthetic===true?'SYNTHETIC' as const:r.provenance.synthetic===false&&r.extractionStatus==='VERIFIED'?'REAL' as const:'UNKNOWN' as const;}),
    ...(plan.selectedObservedUrls || []).map(() => 'UNKNOWN' as const),
  ]);
  const conversationOrigin = {
      sourceProvenance:provenance,
      collectionId: plan.collectionId,
      planId: plan.id,
      planRevision: plan.revision,
      bundleHash: plan.bundleHash,
      selectionRevision: plan.selectionRevision,
      selectedReplyIds: plan.selectedReplyIds,
      selectedObservedUrls: plan.selectedObservedUrls || [],
  };
  if (s.productionOrigin) {
    const origin = { ...s.productionOrigin, conversation: conversationOrigin };
    s.productionOrigin = origin;
    s.project.productionOrigin = origin;
  }
  s.project.editorialPlan = JSON.parse(JSON.stringify(plan));
  s.items = plan.sections
    .filter((section) => section.narrationText.trim())
    .map((section, order): StudioItem => {
      const reply = plan.bundle.collection.replies.find(
          (r) => r.id === section.sourceId,
        ),
        observedRow = section.sourceId ? observed.get(section.sourceId) : undefined,
        source = reply || observedRow || root;
      const commentary = section.kind === 'COMMENTARY';
      return {
        id: section.id,
        sourceId: commentary ? undefined : reply ? reply.id : observedRow ? observedRow.id : original.sourceId,
        sourceReference: {
          entityType: reply || observedRow ? 'COMMENT' : 'POST',
          entityId: source.id,
        },
        sourceUrl: source.url,
        author: commentary
          ? { displayName: 'Bình luận biên tập' }
          : observedRow
            ? { displayName: observedRow.author, handle: observedRow.author }
          : {
              displayName: (reply || root).author.name || (reply || root).author.handle,
              handle: (reply || root).author.handle,
            },
        originalText: section.originalText,
        displayText: section.displayText,
        spokenText: section.narrationText,
        mediaReferences: [],
        selected: true,
        order,
        revision: 0,
        manualLocks: section.locked ? ['DISPLAY_TEXT', 'NARRATION_TEXT'] : [],
        voiceSettings: original.voiceSettings,
        editorial: {
          planId: plan.id,
          sectionId: section.id,
          kind: section.kind,
          stage: section.stage,
          parentId: section.parentId,
          permalink: section.permalink,
          sourceEvidence: section.sourceEvidence,
        },
        ...(!commentary
          ? {
              rawExtraction: reply
                ? {
                    text: reply.originalText,
                    author: reply.author.name || reply.author.handle,
                    handle: reply.author.handle,
                    avatar: null,
                    createdAt: reply.publishedAt,
                    type: 'COMMENT',
                    parentReference: reply.parentId,
                    media: [],
                    likeCount: reply.engagement.likes,
                    replyCount: reply.engagement.replies,
                    repostCount: reply.engagement.reposts,
                    shareCount: reply.engagement.shares,
                    provenance: {
                      text: 'Verified conversation ' + plan.collectionId,
                      parent: JSON.stringify(reply.evidence),
                    },
                  }
                : observedRow
                  ? {
                      ...observedRow.raw,
                      bodyText: observedRow.originalText,
                      text: observedRow.originalText,
                      type: 'UNKNOWN' as const,
                      parentReference: null,
                      provenance: {
                        ...observedRow.raw.provenance,
                        parent: 'Observed on target page; parent relationship unverified',
                      },
                    }
                : original.rawExtraction,
              metadata: reply ? undefined : original.metadata,
            }
          : {}),
      };
    });
  s.project.posts[0].commentIds = [...plan.selectedReplyIds];
  s.project.posts[0].commentIds.push(...(plan.selectedObservedUrls || []).map((url) => observedContextViews(plan.bundle.collection).find((row) => row.url === url)!.id));
  s.project.comments = plan.selectedReplyIds.map((id) => {
    const r = plan.bundle.collection.replies.find((x) => x.id === id)!;
    return {
      id: r.id,
      sourceId: r.id,
      postId: root.id,
      ...(r.parentId !== root.id ? { parentCommentId: r.parentId } : {}),
      author: {
        displayName: r.author.name || r.author.handle,
        handle: r.author.handle,
      },
      text: r.originalText,
      mediaAssetIds: [],
      relationshipStatus: 'PARENT_VERIFIED' as const,
    };
  });
  s.project.comments.push(...(plan.selectedObservedUrls || []).map((url) => {
    const row = observedContextViews(plan.bundle.collection).find((candidate) => candidate.url === url)!;
    return {
      id: row.id,
      sourceId: row.id,
      postId: root.id,
      author: { displayName: row.author, handle: row.author },
      text: row.originalText,
      mediaAssetIds: [],
      relationshipStatus: 'OBSERVED_ON_TARGET_PAGE' as const,
      observedTargetUrl: root.url,
    };
  }));
  s.project.sources.push(
    ...plan.selectedReplyIds.map((id) => {
      const r = plan.bundle.collection.replies.find((x) => x.id === id)!;
      return {
        id: r.id,
        platform: 'THREADS' as const,
        canonicalUrl: r.url,
        retrievedAt: r.provenance.observedAt,
        synthetic: r.provenance.synthetic,
      };
    }),
    ...(plan.selectedObservedUrls || []).map((url) => {
      const row = observedContextViews(plan.bundle.collection).find((candidate) => candidate.url === url)!;
      return {
        id: row.id,
        platform: 'THREADS' as const,
        canonicalUrl: row.url,
        retrievedAt: plan.bundle.collection.completedAt,
        synthetic: plan.bundle.collection.root.provenance.synthetic,
      };
    }),
  );
  const template = s.project.storyboard[0];
  s.project.storyboard = s.items.map((i) => ({
    ...template,
    editorial:i.editorial?{kind:i.editorial.kind,stage:i.editorial.stage}:undefined,
    id: i.id,
    order: i.order,
    sourceReferences: [i.sourceReference],
    displayText: i.displayText,
    narrationText: i.spokenText,
    styleProperties: {
      style: 'SERIOUS',
      template: 'STORY_CARD',
      cardMode:
        i.editorial?.kind === 'COMMENTARY'
          ? 'NARRATION'
          : i.sourceReference.entityType,
      tone: 'ANALYTICAL',
    },
    manualOverride: { lockedFields: [], revision: 0 },
  }));
  s.editor = editorSettings(s);
  return s;
}
