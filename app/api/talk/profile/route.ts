import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { listProfileFields, listProfiles, setProfileFields, updateMyProfile } from '@/lib/talk-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withTalk(async ({ actor }) => NextResponse.json({ profiles: await listProfiles(actor), fields: await listProfileFields(actor.workspaceId) }));
}

const mine = z.object({
  title: z.string().max(100).optional(),
  pronouns: z.string().max(40).optional(),
  phone: z.string().max(32).optional(),
  timezone: z.string().max(64).optional(),
  fields: z.record(z.string(), z.string().max(200)).optional(),
});

/** Mi perfil (cargo, pronombres, teléfono, zona horaria y campos del workspace). */
export async function PATCH(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, mine);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json({ profile: await updateMyProfile(actor, body) });
    },
    { write: 'profile', limit: 60 },
  );
}

const fields = z.object({ fields: z.array(z.object({ id: z.string().max(64).optional(), label: z.string().max(60) })).max(12) });

/** Campos de perfil del workspace (admins). */
export async function PUT(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const body = await readBody(req, fields);
      if (!body) return jsonError(400, 'invalid_input');
      return NextResponse.json({ fields: await setProfileFields(actor, body.fields) });
    },
    { write: 'profile', limit: 60 },
  );
}
