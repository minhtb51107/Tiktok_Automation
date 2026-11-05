import type { StudioSession, StudioItem } from '../studio/studio.contracts';
import type { EditorialPlan } from './editorial-contracts';
import { editorSettings } from '../video-pipeline/editor-state';
import {sourceProvenance,combinedProvenance} from './studio-integration';
/** Extends the existing DATA03 seed, preserving root and reply identities separately from editorial scene IDs. */
export function editorialSession(
  s: StudioSession,
  plan: EditorialPlan,
): StudioSession {
  const root = plan.bundle.collection.root,
    original = s.items[0];
  const provenance=combinedProvenance([
    sourceProvenance({sourceUrl:root.url,sourcePostId:root.id,provenance:{synthetic:root.provenance.synthetic,identityEvidence:root.provenance.method==='EXISTING_EXACT_TARGET_EXTRACTOR'?'DOM_PERMALINK':undefined}}),
    ...plan.selectedReplyIds.map(id=>{const r=plan.bundle.collection.replies.find(r=>r.id===id)!;return r.provenance.synthetic===true?'SYNTHETIC' as const:r.provenance.synthetic===false&&r.extractionStatus==='VERIFIED'?'REAL' as const:'UNKNOWN' as const;})
  ]);
  const origin = {
    ...s.productionOrigin!,
    conversation: {
      sourceProvenance:provenance,
      collectionId: plan.collectionId,
      planId: plan.id,
      planRevision: plan.revision,
      bundleHash: plan.bundleHash,
      selectionRevision: plan.selectionRevision,
      selectedReplyIds: plan.selectedReplyIds,
    },
  };
  s.productionOrigin = origin;
  s.project.productionOrigin = origin;
  s.project.editorialPlan = JSON.parse(JSON.stringify(plan));
  s.items = plan.sections
    .filter((section) => section.narrationText.trim())
    .map((section, order): StudioItem => {
      const reply = plan.bundle.collection.replies.find(
          (r) => r.id === section.sourceId,
        ),
        source = reply || root;
      const commentary = section.kind === 'COMMENTARY';
      return {
        id: section.id,
        sourceId: commentary ? undefined : reply ? reply.id : original.sourceId,
        sourceReference: {
          entityType: reply ? 'COMMENT' : 'POST',
          entityId: source.id,
        },
        sourceUrl: source.url,
        author: commentary
          ? { displayName: 'Bình luận biên tập' }
          : {
              displayName: source.author.name || source.author.handle,
              handle: source.author.handle,
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
        },
        ...(!commentary
          ? {
              rawExtraction: reply
                ? {
                    text: source.originalText,
                    author: source.author.name || source.author.handle,
                    handle: source.author.handle,
                    avatar: null,
                    createdAt: source.publishedAt,
                    type: 'COMMENT',
                    parentReference: reply.parentId,
                    media: [],
                    likeCount: source.engagement.likes,
                    replyCount: source.engagement.replies,
                    repostCount: source.engagement.reposts,
                    shareCount: source.engagement.shares,
                    provenance: {
                      text: 'Verified conversation ' + plan.collectionId,
                      parent: JSON.stringify(reply.evidence),
                    },
                  }
                : original.rawExtraction,
              metadata: reply ? undefined : original.metadata,
            }
          : {}),
      };
    });
  s.project.posts[0].commentIds = plan.selectedReplyIds;
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
    };
  });
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
