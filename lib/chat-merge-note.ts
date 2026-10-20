/**
 * Chat — marca del merge de conversaciones (lib/chat-merge.ts). Es un mensaje
 * de sistema en el hilo unido; el inbox lo muestra traducido. Puro (lo usa
 * el inbox en el navegador).
 */
export const MERGE_NOTE_PREFIX = 'merged:';

/** "merged:<inicio del origen>:<mensajes movidos>". */
export function mergeNoteBody(sourceCreatedAt: string, moved: number): string {
  return `${MERGE_NOTE_PREFIX}${sourceCreatedAt}:${moved}`;
}

export function parseMergeNote(body: string): { startedAt: string; count: number } | null {
  const m = /^merged:(.+):(\d+)$/.exec(body);
  return m ? { startedAt: m[1], count: Number(m[2]) } : null;
}
