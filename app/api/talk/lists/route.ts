import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withTalk, readBody } from '@/lib/talk-http';
import { jsonError } from '@/lib/write-limit';
import {
  addComment,
  addItem,
  createList,
  deleteComment,
  deleteItem,
  deleteList,
  getList,
  listComments,
  listLists,
  updateItem,
  updateList,
} from '@/lib/talk-lists';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ?channelId= → listas del canal; ?id= → una lista con sus ítems; ?id=&item= → comentarios del ítem. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const item = sp.get('item');
  return withTalk(async ({ actor }) => {
    if (id && item) return NextResponse.json({ comments: await listComments(actor, id, item) });
    if (id) return NextResponse.json(await getList(actor, id));
    return NextResponse.json({ lists: await listLists(actor, sp.get('channelId') ?? '') });
  });
}

const id = z.string().max(64);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), channelId: id, name: z.string().max(80), template: z.enum(['tasks', 'blank']).optional() }),
  z.object({ action: z.literal('update'), listId: id, name: z.string().max(80).optional(), fields: z.array(z.unknown()).max(20).optional(), views: z.array(z.unknown()).max(20).optional() }),
  z.object({ action: z.literal('delete'), listId: id }),
  z.object({ action: z.literal('addItem'), listId: id, title: z.string().max(500), data: z.record(z.string(), z.unknown()).optional() }),
  z.object({
    action: z.literal('updateItem'),
    listId: id,
    itemId: id,
    title: z.string().max(500).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    position: z.number().optional(),
  }),
  z.object({ action: z.literal('deleteItem'), listId: id, itemId: id }),
  z.object({ action: z.literal('comment'), listId: id, itemId: id, body: z.string().max(4000) }),
  z.object({ action: z.literal('deleteComment'), listId: id, itemId: id, commentId: id }),
]);

export async function POST(req: NextRequest) {
  return withTalk(
    async ({ actor }) => {
      const b = await readBody(req, schema);
      if (!b) return jsonError(400, 'invalid_input');
      switch (b.action) {
        case 'create':
          return NextResponse.json({ list: await createList(actor, b.channelId, { name: b.name, template: b.template }) }, { status: 201 });
        case 'update':
          return NextResponse.json({ list: await updateList(actor, b.listId, { name: b.name, fields: b.fields, views: b.views }) });
        case 'delete':
          await deleteList(actor, b.listId);
          return NextResponse.json({ ok: true });
        case 'addItem':
          return NextResponse.json({ item: await addItem(actor, b.listId, { title: b.title, data: b.data }) }, { status: 201 });
        case 'updateItem':
          await updateItem(actor, b.listId, b.itemId, { title: b.title, data: b.data, position: b.position });
          return NextResponse.json({ ok: true });
        case 'deleteItem':
          await deleteItem(actor, b.listId, b.itemId);
          return NextResponse.json({ ok: true });
        case 'comment':
          return NextResponse.json({ comment: await addComment(actor, b.listId, b.itemId, b.body) }, { status: 201 });
        case 'deleteComment':
          await deleteComment(actor, b.listId, b.itemId, b.commentId);
          return NextResponse.json({ ok: true });
      }
    },
    { write: 'lists', limit: 300 },
  );
}
