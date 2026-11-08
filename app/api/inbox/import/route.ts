import { iJson, withOwner } from '@/lib/inbox/http';
import { importPart, parseImport } from '@/lib/inbox/import';
import { InboxError } from '@/lib/inbox/types';
import { readTextCapped } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tope de una parte (la pantalla manda los mensajes en tandas de 500). */
const MAX_BODY = 4 * 1024 * 1024;

/** Una parte de la exportación de inbox-zero (ver lib/inbox/import.ts). */
export async function POST(req: Request) {
  return withOwner(async (owner) => {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) throw new InboxError('too_large', 413);
    const raw = await readTextCapped(new Response(req.body), MAX_BODY + 1);
    if (Buffer.byteLength(raw) > MAX_BODY) throw new InboxError('too_large', 413);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new InboxError('invalid_file', 400);
    }
    return iJson({ result: await importPart(owner, parseImport(json)) });
  });
}
