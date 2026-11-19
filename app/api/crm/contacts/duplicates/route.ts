import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { findDuplicateContacts } from '@/lib/crm-contact-email';
import { unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Grupos de contactos que comparten email (?contactId= solo el suyo). Solo lo visible para quien pide. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const contactId = req.nextUrl.searchParams.get('contactId') || undefined;
  const groups = await findDuplicateContacts(user.id, { ownerScope: await sessionScope(user), contactId });
  return NextResponse.json({
    groups: groups.map((g) => ({
      email: g.email,
      contacts: g.contacts.map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        phone: c.phone,
        job_title: c.job_title,
        created_at: c.created_at,
      })),
    })),
  });
}
