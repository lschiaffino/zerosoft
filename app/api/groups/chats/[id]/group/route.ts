import { NextResponse } from 'next/server';
import { leaveGroup, updateGroupSettings } from '@/lib/groups-org';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Ajustes del grupo en WhatsApp:
 * { action: 'settings', announce?, locked?, ephemeral?, picture?: { url, mimetype } | null }
 * o { action: 'leave' } para salir del grupo.
 */
export async function POST(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const b = await readJson(req);
  try {
    if (b.action === 'leave') return NextResponse.json(await leaveGroup(s.ws, id));
    if (b.action !== 'settings') return groupsError(400, 'invalid_action');
    let picture: { url: string; mimetype: string } | null | undefined;
    if (b.picture === null) picture = null;
    else if (b.picture && typeof b.picture === 'object') {
      const p = b.picture as Record<string, unknown>;
      picture = { url: str(p.url, 1000) ?? '', mimetype: str(p.mimetype, 100) ?? '' };
    }
    return NextResponse.json(
      await updateGroupSettings(
        s.ws,
        id,
        {
          announce: typeof b.announce === 'boolean' ? b.announce : undefined,
          locked: typeof b.locked === 'boolean' ? b.locked : undefined,
          ephemeral: typeof b.ephemeral === 'number' ? b.ephemeral : undefined,
          picture,
        },
        new URL(req.url).origin,
      ),
    );
  } catch (err) {
    return handleGroupsError(err);
  }
}
