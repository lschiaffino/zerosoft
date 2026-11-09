/** Inbox: esquemas de entrada de las rutas API. */
import { z } from 'zod';
import type { ThreadAction } from './core';
import { LIMITS } from './types';

const id = z.string().min(1).max(60);
const iso = z.string().min(1).max(40);

export const actionSchema: z.ZodType<ThreadAction> = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['done', 'undone', 'read', 'unread', 'pin', 'unpin', 'unsnooze', 'clearFollowUp', 'seen']) }),
  z.object({ action: z.literal('snooze'), until: iso }),
  z.object({ action: z.literal('followUp'), at: iso }),
  z.object({ action: z.literal('mute'), until: iso.nullable() }),
  z.object({ action: z.enum(['addFolder', 'removeFolder']), folderId: id }),
]) as z.ZodType<ThreadAction>;

export const bulkActionSchema = z.object({ ids: z.array(id).min(1).max(500) }).and(actionSchema);

export const threadPatchSchema = z.union([
  actionSchema,
  z.object({ draft: z.string().max(LIMITS.draft) }),
  z.object({ notes: z.string().max(LIMITS.notes) }),
  z.object({ title: z.string().min(1).max(200) }),
]);

export const sendSchema = z.object({ body: z.string().min(1).max(LIMITS.message), sendAt: iso.optional() });

const rule = z
  .object({
    channel: z.enum(['whatsapp', 'gmail']).optional(),
    kind: z.enum(['dm', 'group', 'email']).optional(),
    from: z.string().max(80).optional(),
  })
  .nullable();

export const folderCreateSchema = z.object({
  name: z.string().min(1).max(LIMITS.folderName),
  color: z.string().max(20).optional(),
  icon: z.string().max(16).optional(),
  parentId: id.nullable().optional(),
  rule: rule.optional(),
});

export const folderPatchSchema = z.object({
  name: z.string().min(1).max(LIMITS.folderName).optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(16).optional(),
  parentId: id.nullable().optional(),
  rule: rule.optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});

export const reorderSchema = z.object({ ids: z.array(id).max(LIMITS.folders) });

export const snippetCreateSchema = z.object({
  title: z.string().min(1).max(LIMITS.snippetTitle),
  body: z.string().min(1).max(LIMITS.snippetBody),
  shortcut: z.string().max(40).optional(),
});

export const snippetPatchSchema = snippetCreateSchema.partial();

export const scheduledCreateSchema = z.object({ threadId: id, body: z.string().min(1).max(LIMITS.message), sendAt: iso });
export const scheduledPatchSchema = z.object({ body: z.string().min(1).max(LIMITS.message).optional(), sendAt: iso.optional() });

export const composeSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('whatsapp'), to: z.string().min(4).max(40), body: z.string().max(LIMITS.message).optional() }),
  z.object({
    channel: z.literal('gmail'),
    accountId: id.optional(),
    to: z.string().min(3).max(1000),
    subject: z.string().max(300).default(''),
    body: z.string().min(1).max(LIMITS.message),
  }),
]);

export const aiSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draft'), threadId: id, instruction: z.string().max(2000).optional(), stream: z.boolean().optional() }),
  z.object({
    action: z.literal('rewrite'),
    text: z.string().min(1).max(6000),
    mode: z.enum(['shorter', 'friendlier', 'formal', 'fix', 'custom']),
    instruction: z.string().max(1000).optional(),
    threadId: id.optional(),
    stream: z.boolean().optional(),
  }),
]);
