import {
  ContentAuthor,
  ContentSource,
  ThreadComment,
  ThreadPost,
} from './contracts';

export interface RawThreadComment {
  id: string;
  author: ContentAuthor;
  text: string;
  parentCommentId?: string;
}

export interface RawThreadPost {
  id: string;
  url: string;
  retrievedAt: string;
  synthetic: boolean;
  author: ContentAuthor;
  text: string;
  comments: RawThreadComment[];
}

export interface NormalizedThreadContent {
  source: ContentSource;
  post: ThreadPost;
  comments: ThreadComment[];
}

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const duplicateKey = (value: string): string =>
  normalizeText(value).toLocaleLowerCase('vi-VN');

export const normalizeThreadContent = (
  raw: RawThreadPost,
): NormalizedThreadContent => {
  const sourceId = `source:${raw.id}`;
  const seenComments = new Set<string>();
  const comments: ThreadComment[] = [];

  for (const rawComment of raw.comments) {
    const text = normalizeText(rawComment.text);
    const key = duplicateKey(text);
    if (!text || seenComments.has(key)) continue;
    seenComments.add(key);
    comments.push({
      id: rawComment.id,
      sourceId,
      postId: raw.id,
      ...(rawComment.parentCommentId
        ? { parentCommentId: rawComment.parentCommentId }
        : {}),
      author: rawComment.author,
      text,
      mediaAssetIds: [],
    });
  }

  return {
    source: {
      id: sourceId,
      platform: 'THREADS',
      canonicalUrl: raw.url,
      retrievedAt: raw.retrievedAt,
      synthetic: raw.synthetic,
    },
    post: {
      id: raw.id,
      sourceId,
      externalId: raw.id,
      author: raw.author,
      text: normalizeText(raw.text),
      mediaAssetIds: [],
      commentIds: comments.map((comment) => comment.id),
    },
    comments,
  };
};
