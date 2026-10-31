import { NextResponse } from 'next/server';
import { chatError, chatSession } from '@/lib/chat-http';
import { importConversations, parseImport } from '@/lib/chat-import';
import { recordChatAudit } from '@/lib/chat-audit';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024;

/** multipart: widgetId + file (JSON de la API de Intercom o Crisp). Admins. */
export async function POST(req: Request) {
  const s = await chatSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const widgetId = String(form?.get('widgetId') ?? '');
  if (!(file instanceof File) || !s.widgets.some((w) => w.id === widgetId)) return chatError(400, 'invalid_input');
  if (file.size > MAX_BYTES) return chatError(413, 'file_too_large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return chatError(400, 'invalid_file');
  }
  const conversations = parseImport(parsed);
  if (conversations.length === 0) return chatError(400, 'nothing_to_import');
  const result = await importConversations(widgetId, conversations);
  await recordChatAudit(s.ws, s.me, 'import.done', { widgetId, ...result });
  return NextResponse.json(result, { status: 201 });
}
