import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { applyBulkAction, parseBulkRequest } from '@/lib/chat-inbox';
import { attributesBlockingResolve } from '@/lib/chat-attributes-db';
import { ingestChatConversation, runAfterResponse, supportWidgetId } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

/**
 * Acción en lote del inbox: { ids, action } con action = assign | tag |
 * snooze | resolve (las mismas que de a una). Cada conversación se valida
 * por separado: las ajenas al workspace no se tocan y cuentan como salteadas.
 * Resolver saltea las que tienen atributos obligatorios sin completar
 * (cuentan como salteadas y además en `blocked`).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = parseBulkRequest(await req.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  let updated = 0;
  let skipped = 0;
  /** Resolver salteado por atributos obligatorios sin completar. */
  let blocked = 0;
  const resolvedSupport: string[] = [];
  for (const id of parsed.ids) {
    const { ok, conversation } = await canAccessConversation(id, user);
    if (!ok || !conversation) {
      skipped++;
      continue;
    }
    if (parsed.action.type === 'resolve' && conversation.status !== 'resolved' && (await attributesBlockingResolve(conversation)).length > 0) {
      skipped++;
      blocked++;
      continue;
    }
    const after = await applyBulkAction(conversation, parsed.action);
    if (!after) {
      skipped++;
      continue;
    }
    updated++;
    // Igual que el PATCH de una conversación: soporte propio resuelto → roadmap.
    if (after.status === 'resolved' && conversation.status !== 'resolved' && supportWidgetId() && after.widget_id === supportWidgetId()) {
      resolvedSupport.push(after.id);
    }
  }
  if (resolvedSupport.length > 0) {
    await runAfterResponse(async () => {
      for (const id of resolvedSupport) await ingestChatConversation(id);
    });
  }
  return NextResponse.json(blocked > 0 ? { updated, skipped, blocked } : { updated, skipped });
}
