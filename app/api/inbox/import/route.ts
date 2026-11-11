import { z } from 'zod';
import { iJson, withOwner } from '@/lib/inbox/http';
import { importPart, parseImport } from '@/lib/inbox/import';
import { listImports, MAX_IMPORT_BYTES, setImportState, startFileImport, startGmailImport, startWhatsappImport, stepOwnImport } from '@/lib/inbox/import-jobs';
import { InboxError } from '@/lib/inbox/types';
import { readTextCapped } from '@/lib/safe-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tope de una parte (la pantalla manda los mensajes en tandas de 500). */
const MAX_BODY = 4 * 1024 * 1024;

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('whatsapp') }),
  z.object({ action: z.literal('gmail'), accountId: z.string().min(1).max(60).optional() }),
  z.object({ action: z.literal('file'), url: z.string().min(1).max(600), name: z.string().max(200), size: z.number().int().min(1) }),
  z.object({ action: z.enum(['step', 'pause', 'resume', 'cancel']), id: z.string().min(1).max(60) }),
]);

/** Importaciones de la persona (con su avance) y cómo se suben los archivos grandes. */
export async function GET() {
  return withOwner(async (owner) => iJson({ imports: await listImports(owner), upload: { mode: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'server', max: MAX_IMPORT_BYTES } }));
}

/**
 * - Una parte de la exportación de inbox-zero ({ part: 'meta' | 'messages' },
 *   ver lib/inbox/import.ts): la manda la pantalla en tandas.
 * - { action }: empezar a traer todo el historial de WhatsApp ('whatsapp') o
 *   todo el correo de una cuenta de Gmail ('gmail', con accountId opcional),
 *   importar un archivo ya subido a Blob, avanzar un paso, pausar, seguir o
 *   cancelar. Las dos primeras también arrancan solas al conectar la cuenta.
 */
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
    if (json && typeof json === 'object' && 'action' in json) {
      const a = actionSchema.safeParse(json);
      if (!a.success) throw new InboxError('invalid_input', 400);
      const body = a.data;
      if (body.action === 'whatsapp') return iJson({ import: await startWhatsappImport(owner) }, 201);
      if (body.action === 'gmail') return iJson({ import: await startGmailImport(owner, body.accountId) }, 201);
      if (body.action === 'file') return iJson({ import: await startFileImport(owner, body) }, 201);
      if (body.action === 'step') return iJson({ import: await stepOwnImport(owner, body.id) });
      return iJson({ import: await setImportState(owner, body.id, body.action) });
    }
    return iJson({ result: await importPart(owner, parseImport(json)) });
  });
}
