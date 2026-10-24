import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listObjects, objectEntity } from '@/lib/crm-objects';
import { cleanRow } from '@/lib/crm-http';
import { apiFieldViewer, fieldAccessFor } from '@/lib/crm-field-perms';
import { fieldOptions } from '@/lib/crm-custom-fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Objetos propios del workspace con sus propiedades (las que la key puede ver). */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const objects = await listObjects(auth.user.id);
  const viewer = apiFieldViewer(auth);
  const out = await Promise.all(
    objects.map(async (o) => {
      const { visible } = await fieldAccessFor(viewer, objectEntity(o.id));
      return {
        ...cleanRow(o),
        properties: visible.map((f) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          options: fieldOptions(f),
          readOnly: f.access === 'read',
        })),
      };
    }),
  );
  return NextResponse.json({ objects: out });
}
