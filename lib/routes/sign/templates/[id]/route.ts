import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteTemplate, getTemplate, templateDto, updateTemplate } from '@/lib/sign/templates';
import { FIELD_KINDS, type FieldKind } from '@/lib/sign/types';
import { parseBody, sFail, signActor, sJson, type Ctx } from '@/lib/sign/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    return sJson({ template: templateDto(await getTemplate(a.actor, (await params).id), a.actor) });
  } catch (err) {
    return sFail(err);
  }
}

const schema = z.object({
  name: z.string().max(160).optional(),
  description: z.string().max(500).optional(),
  message: z.string().max(4000).optional(),
  signingOrder: z.enum(['sequential', 'parallel']).optional(),
  otpRequired: z.boolean().optional(),
  expiresDays: z.number().int().min(1).max(365).optional(),
  reminderDays: z.number().int().min(0).max(30).optional(),
  roles: z.array(z.object({ key: z.string().max(20), name: z.string().max(60), role: z.enum(['signer', 'approver', 'cc']), order: z.number().int().min(1).max(50) })).max(20).optional(),
  fields: z
    .array(
      z.object({
        roleKey: z.string().max(20),
        kind: z.enum(FIELD_KINDS as [FieldKind, ...FieldKind[]]),
        page: z.number().int().min(1).max(1000),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        required: z.boolean().optional(),
        label: z.string().max(80).optional(),
        options: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .max(500)
    .optional(),
});

/** PATCH: nombre, ajustes, roles y campos (quien la creó o un admin). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    return sJson({ template: templateDto(await updateTemplate(a.actor, (await params).id, await parseBody(req, schema)), a.actor) });
  } catch (err) {
    return sFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await signActor();
  if ('res' in a) return a.res;
  try {
    await deleteTemplate(a.actor, (await params).id);
    return sJson({ ok: true });
  } catch (err) {
    return sFail(err);
  }
}
