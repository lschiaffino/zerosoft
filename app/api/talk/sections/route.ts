import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import { createSection, deleteSection, listSections, moveToSection, updateSection } from '@/lib/talk-sections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withTalk(async ({ actor }) => NextResponse.json({ sections: await listSections(actor) }));
}

const id = z.string().max(64);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().max(60), channelId: id.optional() }),
  z.object({ action: z.literal('update'), id, name: z.string().max(60).optional(), sort: z.enum(['alpha', 'recent']).optional(), move: z.union([z.literal(-1), z.literal(1)]).optional() }),
  z.object({ action: z.literal('delete'), id }),
  z.object({ action: z.literal('move'), channelId: id, sectionId: id.nullable() }),
]);

/** Secciones propias del sidebar: crear (y mover un canal adentro), renombrar, ordenar, borrar y mover canales. */
export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const b = await readBody(req, schema);
      if (!b) return jsonError(400, 'invalid_input');
      if (b.action === 'create') {
        const s = await createSection(actor, b.name);
        if (b.channelId) await moveToSection(actor, b.channelId, s.id);
        return NextResponse.json({ section: s }, { status: 201 });
      }
      if (b.action === 'update') await updateSection(actor, b.id, { name: b.name, sort: b.sort, move: b.move });
      else if (b.action === 'delete') await deleteSection(actor, b.id);
      else await moveToSection(actor, b.channelId, b.sectionId);
      return NextResponse.json({ sections: await listSections(actor) });
    },
    { write: 'sections', limit: 120 },
  );
}
