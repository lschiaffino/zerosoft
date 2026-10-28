/**
 * Notes — export ENEX con los adjuntos adentro (solo servidor).
 */
import type { DocsBlock } from './docs-types';
import { findFileBlock, isFileBlockType } from './docs-files';
import { fileBlockResponse } from './upload-serve';
import { ENEX_HEAD, ENEX_TAIL, enexResource, noteToEnex, type EnexResourceOut } from './notes-export';
import { noteFileHref, type NoteDetail } from './notes-types';

/** Tope de adjuntos embebidos por export (lo que pasa queda como link). */
export const ENEX_EMBED_BUDGET = 60 * 1024 * 1024;

async function readFileBlock(blocks: DocsBlock[], blockId: string): Promise<Uint8Array | null> {
  const block = findFileBlock(blocks, blockId);
  if (!block) return null;
  const res = await fileBlockResponse(block, { download: true }).catch(() => null);
  if (!res || !res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * ENEX de varias notas en stream (una por vez, sin juntar todo en memoria):
 * en Vercel una respuesta en stream no tiene el tope de 4.5 MB.
 */
export function enexStream(
  notes: AsyncIterable<NoteDetail> | Iterable<NoteDetail>,
  opts: { origin: string; lockedText: string },
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let budget = ENEX_EMBED_BUDGET;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(ENEX_HEAD()));
        for await (const note of notes as AsyncIterable<NoteDetail>) {
          const files = new Map<string, EnexResourceOut>();
          if (!note.locked) {
            for (const b of note.content) {
              if (!isFileBlockType(b.type) || !b.url) continue;
              if ((b.size ?? 0) > budget) continue;
              const bytes = await readFileBlock(note.content, b.id);
              if (!bytes || bytes.length > budget) continue;
              budget -= bytes.length;
              files.set(b.id, enexResource(bytes, b.mime || 'application/octet-stream', b.name || 'file'));
            }
          }
          controller.enqueue(
            enc.encode(
              noteToEnex(note, {
                files,
                lockedText: opts.lockedText,
                fileLink: (b) => `${opts.origin}${noteFileHref(note.id, b.id, { download: true })}`,
              }),
            ),
          );
        }
        controller.enqueue(enc.encode(ENEX_TAIL));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
