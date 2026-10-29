import { NextResponse } from 'next/server';
import { assistantModelId, assistantState } from '@/lib/assistant/config';
import { assistantUser } from '@/lib/assistant/http';
import { toolSummary } from '@/lib/assistant/tools';
import { isWorkspaceAdmin } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado del asistente para la sesión: configurado o no, y las herramientas que puede usar. */
export async function GET() {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({
    state: assistantState(),
    admin: isWorkspaceAdmin(user),
    model: assistantModelId(),
    tools: toolSummary(user),
  });
}
