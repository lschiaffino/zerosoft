/**
 * Usar un adjunto del asistente en una acción: mandarlo a un chat de Groups,
 * adjuntarlo a un issue de Track o sumarlo a una página de Docs. Pasan por
 * las operaciones del catálogo (mismos permisos y auditoría que el MCP) y,
 * como toda escritura del asistente, esperan la tarjeta de confirmación.
 */
import { z } from 'zod';
import { getOperation, type Operation } from '../mcp/catalog';
import { attachmentKind, getAttachments, type AttachmentRow } from './files';
import { writeTool, type AssistantTool, type ToolCtx } from './registry';
import { runCatalog } from './tools-catalog';

const attId = z.string().trim().regex(/^att_[a-z0-9]{8,40}$/).describe('Attachment id from the instructions (att_...).');

const op = (id: string) => getOperation(id) as Operation;
const ownerOf = (ctx: ToolCtx) => ({ workspaceId: ctx.workspaceId, personId: ctx.personId });

async function oneAttachment(ctx: ToolCtx, id: string): Promise<AttachmentRow | null> {
  return (await getAttachments(ownerOf(ctx), [id]))[0] ?? null;
}

type Data = { ok: boolean; data?: unknown; error?: string; status?: number };
function dataOf<T>(r: Data): T | null {
  if (!r.ok || !r.data || typeof r.data !== 'object') return null;
  const d = r.data as { data?: unknown };
  return ((d.data && typeof d.data === 'object' ? d.data : r.data) as T) ?? null;
}

function failure(r: Data): string {
  const d = r.data as { error?: unknown; message?: unknown } | undefined;
  const e = r.error ?? (typeof d?.error === 'object' ? (d.error as { code?: string }).code : d?.error) ?? d?.message ?? `status ${r.status ?? 'error'}`;
  return String(e).slice(0, 200);
}

export const attachmentTools: AssistantTool[] = [
  writeTool({
    name: 'propose_send_attachment',
    app: 'groups',
    destructive: true,
    description:
      'Prepare sending an attached image or file to a Groups (WhatsApp) chat, with an optional caption. It reaches people outside the workspace: the person reviews a card and types "send". Find the chat id with run_operation v1.groups.chats.list.',
    input: z.object({
      chat: z.string().trim().min(1).max(100).describe('Groups chat id.'),
      attachment: attId,
      caption: z.string().trim().max(1000).optional().describe('Text sent with the file.'),
    }),
    prepare: async (ctx, input: { chat: string; attachment: string; caption?: string }) => {
      const file = await oneAttachment(ctx, input.attachment);
      if (!file) return { error: 'unknown_attachment', hint: 'Use an attachment id from the instructions.' };
      const chat = dataOf<{ id: string; name?: string }>(await runCatalog(ctx, op('v1.groups.chats.get'), { path: { id: input.chat } }, {}));
      if (!chat) return { error: 'chat_not_found', hint: 'Look the chat up with run_operation v1.groups.chats.list.' };
      return {
        summary: `Send "${file.name}" to ${chat.name || 'the chat'}`,
        details: [
          { label: 'Chat', after: chat.name || chat.id },
          { label: 'File', after: `${file.name} (${file.mime})` },
          ...(input.caption ? [{ label: 'Caption', after: input.caption }] : []),
        ],
        confirmText: 'send',
        input: { chat: chat.id, attachment: file.id, caption: input.caption ?? '' },
      };
    },
    execute: async (ctx, input) => {
      const r = await runCatalog(
        ctx,
        op('v1.groups.chats.messages.create'),
        { path: { id: String(input.chat) }, body: { body: String(input.caption ?? ''), media: { $attachment: String(input.attachment) } } },
        { confirm: true },
      );
      if (!r.ok) return { ok: false, error: failure(r) };
      const sent = dataOf<{ status?: string }>(r);
      if (sent?.status === 'failed') return { ok: false, error: 'not_delivered' };
      return { ok: true, message: 'File sent.', href: `/app/groups/inbox/${String(input.chat)}` };
    },
  }),
  writeTool({
    name: 'propose_attach_file',
    app: null,
    description:
      'Prepare attaching an attached image or file to a Track issue (as an attachment) or to a Docs page (as an image or file block at the end). The person reviews a card and clicks Confirm.',
    input: z.object({
      target: z.enum(['track_issue', 'docs_page']),
      id: z.string().trim().min(1).max(100).describe('Issue id or identifier (ENG-12), or Docs page id.'),
      attachment: attId,
    }),
    prepare: async (ctx, input: { target: 'track_issue' | 'docs_page'; id: string; attachment: string }) => {
      const file = await oneAttachment(ctx, input.attachment);
      if (!file) return { error: 'unknown_attachment', hint: 'Use an attachment id from the instructions.' };
      if (input.target === 'track_issue') {
        const issue = dataOf<{ id: string; identifier?: string; title?: string }>(await runCatalog(ctx, op('v1.track.issues.get'), { path: { id: input.id } }, {}));
        if (!issue) return { error: 'issue_not_found', hint: 'Check the identifier with run_operation v1.track.issues.list.' };
        return {
          summary: `Attach "${file.name}" to ${issue.identifier ?? 'the issue'}`,
          details: [
            { label: 'Issue', after: `${issue.identifier ?? ''} ${issue.title ?? ''}`.trim() },
            { label: 'File', after: `${file.name} (${file.mime})` },
          ],
          input: { target: 'track_issue', id: issue.id, ref: issue.identifier ?? issue.id, attachment: file.id },
        };
      }
      const page = dataOf<{ id: string; title?: string }>(await runCatalog(ctx, op('v1.docs.pages.get'), { path: { id: input.id } }, {}));
      if (!page) return { error: 'page_not_found', hint: 'Look the page up with run_operation v1.docs.search.list.' };
      return {
        summary: `Add "${file.name}" to "${page.title || 'Untitled'}"`,
        details: [
          { label: 'Page', after: page.title || page.id },
          { label: 'File', after: `${file.name} (${file.mime})` },
        ],
        input: { target: 'docs_page', id: page.id, attachment: file.id },
      };
    },
    execute: async (ctx, input) => {
      const files = [{ field: 'file', attachment: String(input.attachment) }];
      if (input.target === 'track_issue') {
        const r = await runCatalog(ctx, op('track.issues.attachments.create'), { path: { id: String(input.id) }, files }, {});
        if (!r.ok) return { ok: false, error: failure(r) };
        return { ok: true, message: 'Attached to the issue.', href: `/app/track/issue/${String(input.ref ?? input.id)}` };
      }
      const file = await oneAttachment(ctx, String(input.attachment));
      if (!file) return { ok: false, error: 'unknown_attachment' };
      // Primero el archivo a Docs (su storage y sus permisos), después el bloque al final de la página.
      const up = await runCatalog(ctx, op('docs.pages.files.create'), { path: { id: String(input.id) }, files }, {});
      const stored = dataOf<{ url: string; name: string; size: number; mime: string }>(up);
      if (!stored?.url) return { ok: false, error: failure(up) };
      const kind = attachmentKind(file.mime);
      const block = { type: kind === 'image' ? 'image' : kind === 'pdf' ? 'pdf' : 'file', url: stored.url, name: stored.name, size: stored.size, mime: stored.mime };
      const r = await runCatalog(ctx, op('v1.docs.pages.blocks.create'), { path: { id: String(input.id) }, body: { blocks: [block] } }, {});
      if (!r.ok) return { ok: false, error: failure(r) };
      return { ok: true, message: 'Added to the page.', href: `/app/docs/${String(input.id)}` };
    },
  }),
];
