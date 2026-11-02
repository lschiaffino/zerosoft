import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getBranding, saveBranding } from '@/lib/send/core';
import { parseBody, sendActor, sFail, sJson } from '@/lib/send/http';
import { safeBrandColor, safeHttpUrl } from '@/lib/send/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ brandName: z.string().trim().max(80), logoUrl: z.string().max(500), brandColor: z.string().max(7), siteUrl: z.string().max(500) });

export async function GET() {
  const a = await sendActor();
  if ('res' in a) return a.res;
  return sJson({ branding: await getBranding(a.actor.ws) });
}

/** PUT: marca del visor. Solo admins. */
export async function PUT(req: NextRequest) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  if (!a.actor.admin) return sJson({ error: 'forbidden' }, 403);
  try {
    const b = await parseBody(req, schema);
    const branding = { brandName: b.brandName, logoUrl: safeHttpUrl(b.logoUrl), brandColor: safeBrandColor(b.brandColor), siteUrl: safeHttpUrl(b.siteUrl) };
    await saveBranding(a.actor.ws, branding);
    return sJson({ branding });
  } catch (err) {
    return sFail(err);
  }
}
