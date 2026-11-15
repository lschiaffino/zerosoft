import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fJson, parseBody, withFleet } from '@/lib/fleet/api';
import { getPrefs, setPrefs } from '@/lib/fleet/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withFleet(async ({ actor }) => fJson({ prefs: await getPrefs(actor) }));
}

const schema = z.object({
  mirrorInbox: z.boolean().optional(),
  mirrorLines: z.boolean().optional(),
  notify: z.enum(['off', 'done', 'waiting', 'both']).optional(),
  notifyAccountId: z.string().max(100).optional(),
});

/** PUT: espejo en Inbox y Lines y avisos por WhatsApp a tu propio chat. */
export async function PUT(req: NextRequest) {
  return withFleet(async ({ actor }) => {
    const patch = await parseBody(req, schema);
    if (patch.notifyAccountId) {
      const { checkNotifyAccount } = await import('@/lib/fleet/link');
      await checkNotifyAccount(actor, patch.notifyAccountId);
    }
    return fJson({ prefs: await setPrefs(actor, patch) });
  });
}
