import { NextResponse } from 'next/server';
import { getPlatformSettings } from '@/lib/groups-access';
import { listTeams } from '@/lib/groups-inbox';
import { teamForViewer, teamOverview } from '@/lib/groups-lines';
import { groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Equipo de Groups: personas con su rol, equipos, líneas que ven, estado y
 * chats abiertos asignados, y los equipos. Invitar y cambiar roles usa la
 * API del workspace (/api/teams/invites, /api/teams/members/:id): el rol es
 * uno solo para toda la suite.
 */
export async function GET() {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const [people, teams, settings] = await Promise.all([teamOverview(s.ws), listTeams(s.ws), getPlatformSettings(s.ws)]);
  // Un miembro ve nombres y estado; emails, líneas y chats abiertos son de los admins.
  const visible = teamForViewer(people, s.isAdmin);
  return NextResponse.json({
    people: visible,
    teams,
    lineAccess: settings.lineAccess,
    teamAccess: settings.teamAccess,
    reassignOnOffline: settings.reassignOnOffline,
    canEdit: s.isAdmin,
    me: s.me,
  });
}
