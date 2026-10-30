import { NextRequest } from 'next/server';
import { z } from 'zod';
import { saveWorkspaceDefaults, workspaceDefaults } from '@/lib/forms/core';
import { fFail, fJson, formsActor, parseBody } from '@/lib/forms/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await formsActor();
  if ('res' in a) return a.res;
  return fJson({ settings: await workspaceDefaults(a.actor.ws), admin: a.actor.admin });
}

/** PUT: valores por defecto de los formularios nuevos (retención). Solo admins. */
export async function PUT(req: NextRequest) {
  const a = await formsActor();
  if ('res' in a) return a.res;
  try {
    const input = await parseBody(req, z.object({ retentionDays: z.number().int().min(0).max(3650) }));
    return fJson({ settings: await saveWorkspaceDefaults(a.actor, input) });
  } catch (err) {
    return fFail(err);
  }
}
