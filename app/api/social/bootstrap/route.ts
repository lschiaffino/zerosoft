import { NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { isSocialAdmin, listAccounts, listSocialPeople, networkStatuses, socialCounts, socialRoleOf } from '@/lib/social';
import { userCanUseApp } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo que necesita el cliente de Social: cuentas, redes, rol, personas y contadores. */
export async function GET() {
  return withSocial(async ({ actor, user }) => {
    const admin = isSocialAdmin(actor);
    const [accounts, role, counts, people] = await Promise.all([listAccounts(actor), socialRoleOf(actor), socialCounts(actor), listSocialPeople(actor)]);
    return NextResponse.json({
      accounts,
      networks: networkStatuses(),
      role,
      admin,
      counts,
      // Los emails y las cuentas de cada persona, solo para quien administra.
      people: people.map((p) => ({ id: p.id, name: p.name, socialRole: p.socialRole, ...(admin ? { email: p.email, accountIds: p.accountIds } : {}) })),
      me: actor.personId,
      canShorten: userCanUseApp(user, 'link'),
    });
  });
}
