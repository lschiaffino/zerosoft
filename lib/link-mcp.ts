/**
 * Link: servidor MCP (Model Context Protocol, "streamable HTTP" en modo
 * JSON), como el de Dub. Un cliente MCP (Claude, Cursor, ChatGPT…) se conecta
 * a POST /api/v1/links/mcp con una API key (Authorization: Bearer zs_…):
 * links:read para buscar links y leer analytics y conversiones, links:write
 * para crear, editar, archivar y borrar. La key actúa como quien la creó:
 * respeta las carpetas que esa persona puede ver o editar. Server-only.
 */
import { hasScope, type ApiScope } from './api-scopes';
import { roleAtLeast, type TeamRole } from './teams';
import {
  applyLinkPatch,
  createLink,
  deleteLink,
  getLinkForViewer,
  getUserLink,
  linkPatchSchema,
  listLinks,
  toLinkDto,
  type LinkWithDomain,
} from './links';
import { listDomains } from './link-domains';
import { getAnalytics, parseRange } from './track';
import { getWorkspaceAnalytics, getWorkspaceConversions, parseWorkspaceFilters, parseWorkspaceRange } from './link-analytics';
import { linkConversionTotals, listLinkConversions } from './link-conversions';
import { listLinkActivity } from './link-activity';
import type { LinkViewer } from './link-folders';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface LinkMcpContext {
  ws: string;
  personId: string;
  scopes: ApiScope[];
  role: TeamRole;
}

class McpToolError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type Json = Record<string, unknown>;

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: ApiScope;
  readOnly: boolean;
  destructive?: boolean;
  inputSchema: Json;
  run: (ctx: LinkMcpContext, args: Json) => Promise<unknown>;
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

function viewerOf(ctx: LinkMcpContext): LinkViewer {
  return { id: ctx.personId, admin: roleAtLeast(ctx.role, 'admin') };
}

async function linkFor(ctx: LinkMcpContext, id: string, need: 'view' | 'edit'): Promise<LinkWithDomain> {
  const found = await getLinkForViewer(ctx.ws, id, viewerOf(ctx), need);
  if ('status' in found) throw new McpToolError(found.status === 403 ? 'forbidden' : 'not_found');
  return found.link;
}

function summary(l: LinkWithDomain) {
  const d = toLinkDto(l);
  return { id: d.id, shortUrl: d.short_url, url: d.url, title: d.title, tags: d.tags, clicks: d.clicks, archived: d.archived, createdAt: d.created_at };
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_links',
    title: 'List links',
    description: 'Searches the short links of the workspace by text (slug, destination or title) and tag. Sorted by newest or by clicks.',
    scope: 'links:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        tag: { type: 'string' },
        sort: { type: 'string', enum: ['created', 'clicks'] },
        archived: { type: 'boolean', description: 'true lists only archived links' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
    run: async (ctx, a) => {
      const res = await listLinks(ctx.ws, {
        q: str(a.q, 200),
        tag: str(a.tag, 40),
        sort: a.sort === 'clicks' ? 'clicks' : 'created',
        archived: a.archived === true ? '1' : '0',
        viewer: viewerOf(ctx),
        pageSize: typeof a.limit === 'number' ? a.limit : 20,
      });
      return { total: res.total, links: res.links.map(summary) };
    },
  },
  {
    name: 'get_link',
    title: 'Get link',
    description: 'Full settings of a link: destination, UTM, expiration, targeting, conversion tracking and status.',
    scope: 'links:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    run: async (ctx, a) => toLinkDto(await linkFor(ctx, str(a.id, 64) ?? '', 'view')),
  },
  {
    name: 'create_link',
    title: 'Create link',
    description:
      'Creates a short link. Optional: custom slug, verified custom domain (hostname), title, tags (max 5), UTM params, expiration (ISO 8601) and conversion tracking.',
    scope: 'links:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        slug: { type: 'string' },
        domain: { type: 'string' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        utmSource: { type: 'string' },
        utmMedium: { type: 'string' },
        utmCampaign: { type: 'string' },
        expiresAt: { type: 'string' },
        trackConversion: { type: 'boolean' },
      },
    },
    run: async (ctx, a) => {
      let domainId: string | null = null;
      const domain = str(a.domain, 253)?.toLowerCase();
      if (domain) {
        const found = (await listDomains(ctx.ws)).find((d) => d.hostname === domain && d.verified === 1);
        if (!found) throw new McpToolError('invalid_domain');
        domainId = found.id;
      }
      const res = await createLink(ctx.ws, {
        url: str(a.url, 2000) ?? '',
        slug: str(a.slug, 32),
        domainId,
        title: str(a.title, 200),
        tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 40)) : undefined,
        utmSource: str(a.utmSource, 100),
        utmMedium: str(a.utmMedium, 100),
        utmCampaign: str(a.utmCampaign, 100),
        expiresAt: str(a.expiresAt, 40) ?? null,
        trackConversion: a.trackConversion === true,
        createdBy: ctx.personId,
        viewer: viewerOf(ctx),
        via: 'mcp',
      });
      if (!res.ok) throw new McpToolError(res.code);
      return toLinkDto((await getUserLink(ctx.ws, res.link.id))!);
    },
  },
  {
    name: 'update_link',
    title: 'Update link',
    description: 'Changes a link: destination url, slug, title, tags, expiresAt (null clears), archived, trackConversion.',
    scope: 'links:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        url: { type: 'string' },
        slug: { type: 'string' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        expiresAt: { type: ['string', 'null'] },
        archived: { type: 'boolean' },
        trackConversion: { type: 'boolean' },
      },
    },
    run: async (ctx, a) => {
      const link = await linkFor(ctx, str(a.id, 64) ?? '', 'edit');
      const { id: _id, ...rest } = a;
      void _id;
      const parsed = linkPatchSchema.safeParse(rest);
      if (!parsed.success) throw new McpToolError('invalid_input');
      const failed = await applyLinkPatch(link, parsed.data, viewerOf(ctx), { actorId: ctx.personId, via: 'mcp' });
      if (failed) throw new McpToolError(failed.error);
      return toLinkDto((await getUserLink(ctx.ws, link.id))!);
    },
  },
  {
    name: 'delete_link',
    title: 'Delete link',
    description: 'Deletes a link and its click history. Only workspace admins; prefer archiving with update_link.',
    scope: 'links:write',
    readOnly: false,
    destructive: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    run: async (ctx, a) => {
      if (!roleAtLeast(ctx.role, 'admin')) throw new McpToolError('forbidden');
      const link = await linkFor(ctx, str(a.id, 64) ?? '', 'edit');
      await deleteLink(link, { actorId: ctx.personId, via: 'mcp' });
      return { deleted: true, id: link.id };
    },
  },
  {
    name: 'get_link_analytics',
    title: 'Get link analytics',
    description: 'Clicks of one link by day, referrer, country, city, device, browser and OS, plus leads, sales and revenue. range: 7d, 30d, 90d or all.',
    scope: 'links:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, range: { type: 'string', enum: ['7d', '30d', '90d', 'all'] } },
    },
    run: async (ctx, a) => {
      const link = await linkFor(ctx, str(a.id, 64) ?? '', 'view');
      const range = parseRange(str(a.range, 8));
      const [stats, conversions] = await Promise.all([getAnalytics(link.id, link.created_at, range), linkConversionTotals(link.id)]);
      return { link: summary(link), range, ...stats, conversions };
    },
  },
  {
    name: 'get_analytics',
    title: 'Get workspace analytics',
    description:
      'Clicks, QR scans, leads, sales and revenue of all links in a date range (from/to YYYY-MM-DD, max 366 days), with optional filters tag, domain, link, country, device and folder.',
    scope: 'links:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        tag: { type: 'string' },
        country: { type: 'string' },
        device: { type: 'string', enum: ['desktop', 'mobile', 'tablet'] },
        link: { type: 'string' },
        timezone: { type: 'string' },
      },
    },
    run: async (ctx, a) => {
      const range = parseWorkspaceRange(str(a.from, 10), str(a.to, 10));
      const filters = parseWorkspaceFilters(
        Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
      );
      const opts = { filters, timezone: str(a.timezone, 64), viewer: viewerOf(ctx) };
      const [clicks, conversions] = await Promise.all([
        getWorkspaceAnalytics(ctx.ws, range, opts),
        getWorkspaceConversions(ctx.ws, range, opts),
      ]);
      return { ...clicks, conversions };
    },
  },
  {
    name: 'list_conversions',
    title: 'List conversions',
    description: 'Latest leads and sales attributed to a link (customer id, amount in minor units, currency, source).',
    scope: 'links:read',
    readOnly: true,
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    run: async (ctx, a) => {
      const link = await linkFor(ctx, str(a.id, 64) ?? '', 'view');
      return { conversions: await listLinkConversions(link.id, typeof a.limit === 'number' ? a.limit : 50) };
    },
  },
  {
    name: 'list_activity',
    title: 'List activity',
    description: 'Who created, changed, archived or deleted links, newest first. Optional link id.',
    scope: 'links:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { linkId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    run: async (ctx, a) => {
      if (!roleAtLeast(ctx.role, 'admin')) throw new McpToolError('forbidden');
      const res = await listLinkActivity(ctx.ws, { linkId: str(a.linkId, 64), limit: typeof a.limit === 'number' ? a.limit : 50 });
      return { activity: res.rows };
    },
  },
];

export function linkMcpTools(): Array<{ name: string; title: string; description: string; inputSchema: Json; annotations: Json }> {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: t.destructive === true, openWorldHint: !t.readOnly },
  }));
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

export type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const rpcError = (id: RpcRequest['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Una llamada JSON-RPC. null para notificaciones (sin id). */
export async function handleLinkRpc(ctx: LinkMcpContext, req: RpcRequest): Promise<RpcResponse | null> {
  const isNotification = req.id === undefined;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') return isNotification ? null : rpcError(req.id, -32600, 'Invalid request');
  if (isNotification) return null;
  const id = req.id ?? null;
  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'zerosoft-link', title: 'zerosoft Link', version: '1.0.0' },
          instructions:
            'Short links of a zerosoft workspace. create_link shortens a URL; list_links finds links; get_link_analytics and get_analytics answer performance questions (clicks, countries, devices, leads, sales).',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: linkMcpTools() } };
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
      if (!hasScope(ctx.scopes, tool.scope)) {
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `This API key is missing the "${tool.scope}" scope.` }] } };
      }
      const args = (req.params?.arguments && typeof req.params.arguments === 'object' ? req.params.arguments : {}) as Json;
      try {
        const out = await tool.run(ctx, args);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false } };
      } catch (err) {
        const code = err instanceof McpToolError ? err.code : 'server_error';
        if (!(err instanceof McpToolError)) {
          // eslint-disable-next-line no-console
          console.error('[link] mcp tool failed', (err as Error)?.name ?? 'error');
        }
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `Error: ${code}` }] } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}
