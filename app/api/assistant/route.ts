import { NextResponse } from 'next/server';
import { assistantModelId, assistantState } from '@/lib/assistant/config';
import { assistantUser } from '@/lib/assistant/http';
import { toolSummary } from '@/lib/assistant/tools';
import { hasAllApps, isWorkspaceAdmin } from '@/lib/session';
import { noStore } from '@/lib/no-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado del asistente para la sesión: configurado o no, y las herramientas que puede usar. */
async function getPrivate() {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({
    state: assistantState(),
    admin: isWorkspaceAdmin(user),
    webhooks: isWorkspaceAdmin(user) && hasAllApps(user),
    model: assistantModelId(),
    tools: toolSummary(user),
  });
}

/** Datos de la persona: sin caché (lib/no-store.ts). */
export async function GET(...args: Parameters<typeof getPrivate>) {
  return noStore(await getPrivate(...args));
}
