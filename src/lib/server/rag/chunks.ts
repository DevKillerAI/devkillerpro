import { createHash } from 'node:crypto';
import type { KnowledgeDocument, KnowledgeChunk } from './types';

export const hashContent = (content: string) => createHash('sha256').update(content).digest('hex');
export const embeddingInput = (title: string, content: string) => `${title}\n${content}`;
export function validEmbedding(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length === 1536 && vector.every(v => typeof v === 'number' && Number.isFinite(v)) && vector.some(v => v !== 0);
}
/** Prefer paragraph/line boundaries; retain every source character and deterministic order. */
export function splitKnowledgeContent(content: string, maxChars = 1600): string[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 128) throw new Error('Invalid chunk size');
  const parts: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(offset + maxChars, content.length);
    if (end < content.length) {
      const boundary = content.lastIndexOf('\n', end - 1), space = content.lastIndexOf(' ', end - 1);
      if (boundary > offset + maxChars / 2) end = boundary + 1;
      else if (space > offset + maxChars / 2) end = space + 1;
      if (/[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    }
    parts.push(content.slice(offset, end)); offset = end;
  }
  return parts;
}
export function chunksForDocument(document: KnowledgeDocument): KnowledgeChunk[] {
  const chunks = splitKnowledgeContent(document.content);
  return chunks.map((content, index) => {
    const contentHash = hashContent(content), inputHash = hashContent(embeddingInput(document.title, content));
    const canReuse = chunks.length === 1 && validEmbedding(document.embedding)
      && document.embeddingContentHash === inputHash && document.embeddingModel === 'text-embedding-3-small';
    return { id: `${document.id}:${hashContent(`${document.version}:${document.contentHash}:${document.title}`).slice(0, 24)}:${index}`,
      documentId: document.id, documentVersion: document.version, documentHash: document.contentHash, content, contentHash, index,
      ...(canReuse ? { embedding: document.embedding, embeddingModel: document.embeddingModel, embeddingContentHash: inputHash } : {}) };
  });
}
