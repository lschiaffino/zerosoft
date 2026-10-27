/**
 * Cal: servidor MCP (Model Context Protocol, "streamable HTTP" en modo JSON),
 * como el de Calendly. Un cliente MCP (Claude, Cursor, ChatGPT…) se conecta a
 * POST /api/v1/calendar/mcp con una API key (Authorization: Bearer zs_…):
 * cal:read para ver tipos de evento, horarios libres y reservas, cal:write
 * para reservar, cancelar y reprogramar. Solo JSON-RPC por POST. Server-only.
 */
import { hasScope, type ApiScope } from './api-scopes';
import {
  CalendarError,
  bookingDateBounds,
  createBooking,
  findOfferedSlot,
  getAvailableSlots,
  getEventType,
  listEventTypes,
  listUserBookings,
  ownedBooking,
  rescheduleBooking,
  updateBooking,
} from './calendar';
import { afterBookingCancelled, afterBookingCreated, afterBookingRescheduled, bookingPayload } from './calendar-lifecycle';
import { refundCancelledBooking } from './calendar-payments';
import { appBaseUrl } from './calendar-notify';
import { logCalActivity } from './calendar-activity';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export interface CalMcpContext {
  ws: string;
  personId: string;
  handle: string | null;
  scopes: ApiScope[];
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
  run: (ctx: CalMcpContext, args: Json) => Promise<unknown>;
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validTz(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_event_types',
    title: 'List event types',
    description: 'Lists the event types of the workspace (title, duration, active, public booking URL). Secret event types are included and marked.',
    scope: 'cal:read',
    readOnly: true,
    inputSchema: { type: 'object', properties: { activeOnly: { type: 'boolean' } } },
    run: async (ctx, a) => {
      const rows = await listEventTypes(ctx.ws, { activeOnly: a.activeOnly === true });
      return {
        eventTypes: rows.map((et) => ({
          id: et.id,
          slug: et.slug,
          title: et.title,
          durationMin: et.duration_min,
          active: et.active === 1,
          secret: et.hidden === 1,
          url: ctx.handle ? `${appBaseUrl()}/en/book/${ctx.handle}/${et.slug}` : null,
        })),
      };
    },
  },
  {
    name: 'get_available_times',
    title: 'Get available times',
    description: 'Free start times of an event type on a day (YYYY-MM-DD) in a time zone, the same ones the public booking page offers.',
    scope: 'cal:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      required: ['eventTypeId', 'date'],
      properties: { eventTypeId: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, timezone: { type: 'string' } },
    },
    run: async (ctx, a) => {
      const id = str(a.eventTypeId, 64) ?? '';
      if (!(await getEventType(ctx.ws, id))) throw new CalendarError('not_found', 404);
      const date = str(a.date, 10) ?? '';
      if (!DAY.test(date)) throw new CalendarError('invalid_input', 400);
      const tz = validTz(str(a.timezone, 64));
      const slots = await getAvailableSlots(id, tz, date);
      return { timezone: tz, times: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) };
    },
  },
  {
    name: 'list_bookings',
    title: 'List bookings',
    description: 'Bookings of the workspace, filtered by status, invitee name or email (q) and date range (YYYY-MM-DD, in the calendar time zone).',
    scope: 'cal:read',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        status: { type: 'string', enum: ['confirmed', 'pending', 'cancelled', 'no_show'] },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    run: async (ctx, a) => {
      const from = str(a.from, 10);
      const to = str(a.to, 10);
      const bounds = await bookingDateBounds(ctx.ws, from && DAY.test(from) ? from : undefined, to && DAY.test(to) ? to : undefined);
      const status = ['confirmed', 'pending', 'cancelled', 'no_show'].includes(String(a.status)) ? (a.status as 'confirmed') : undefined;
      const rows = await listUserBookings(ctx.ws, {
        q: str(a.q, 200),
        status,
        from: bounds.from,
        to: bounds.to,
        limit: Math.min(100, Math.max(1, Number(a.limit) || 25)),
        order: from ? 'asc' : 'desc',
      });
      return {
        bookings: rows.map((b) =>
          bookingPayload(b, { id: b.event_type_id, slug: '', title: b.event_type_title }),
        ),
      };
    },
  },
  {
    name: 'book_meeting',
    title: 'Book a meeting',
    description:
      'Books a meeting for an invitee at a free start time (use get_available_times first). The invitee gets the confirmation email with the link to reschedule or cancel.',
    scope: 'cal:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['eventTypeId', 'start', 'name', 'email'],
      properties: {
        eventTypeId: { type: 'string' },
        start: { type: 'string', description: 'ISO start time' },
        name: { type: 'string' },
        email: { type: 'string' },
        timezone: { type: 'string', description: 'Invitee time zone (IANA)' },
      },
    },
    run: async (ctx, a) => {
      const et = await getEventType(ctx.ws, str(a.eventTypeId, 64) ?? '');
      if (!et || et.active !== 1 || et.kind === 'poll') throw new CalendarError('not_found', 404);
      if (et.price_cents > 0) throw new CalendarError('payment_required', 409);
      const name = (str(a.name, 200) ?? '').replace(/[\r\n]+/g, ' ');
      const email = str(a.email, 320) ?? '';
      if (!name || !EMAIL.test(email)) throw new CalendarError('invalid_input', 400);
      const tz = validTz(str(a.timezone, 64));
      const start = new Date(str(a.start, 40) ?? '');
      if (Number.isNaN(start.getTime())) throw new CalendarError('invalid_input', 400);
      const slot = await findOfferedSlot(et.id, start, tz);
      if (!slot) throw new CalendarError('slot_unavailable', 409);
      const booking = await createBooking(
        { eventTypeId: et.id, email, name, start: slot.start.toISOString(), timezone: tz, answers: {}, guests: [] },
        { bookedBy: ctx.personId, skipApproval: true },
      );
      const synced = await afterBookingCreated(booking);
      await logCalActivity(ctx.ws, ctx.personId, 'booking.scheduled_on_behalf', { type: 'booking', id: booking.id, summary: `${et.title} · ${name} (MCP)` });
      return { booking: bookingPayload(synced, et) };
    },
  },
  {
    name: 'cancel_booking',
    title: 'Cancel a booking',
    description: 'Cancels a confirmed booking (the invitee is notified and a paid booking is refunded).',
    scope: 'cal:write',
    readOnly: false,
    destructive: true,
    inputSchema: { type: 'object', required: ['bookingId'], properties: { bookingId: { type: 'string' }, reason: { type: 'string' } } },
    run: async (ctx, a) => {
      const before = await ownedBooking(ctx.ws, str(a.bookingId, 64) ?? '');
      if (!before) throw new CalendarError('not_found', 404);
      if (before.status !== 'confirmed') throw new CalendarError('not_confirmed', 409);
      const reason = str(a.reason, 500) ?? null;
      const updated = await updateBooking(before.id, { status: 'cancelled', cancelReason: reason }, { fromStatus: before.status });
      if (!updated) throw new CalendarError('not_found', 404);
      const refunded = await refundCancelledBooking(updated);
      await afterBookingCancelled(refunded, reason);
      await logCalActivity(ctx.ws, ctx.personId, 'booking.cancelled', { type: 'booking', id: before.id, summary: `${before.invitee_name} (MCP)` });
      return { status: 'cancelled', id: before.id };
    },
  },
  {
    name: 'reschedule_booking',
    title: 'Reschedule a booking',
    description: 'Moves a confirmed booking to another free start time of its event type; the invitee gets the update.',
    scope: 'cal:write',
    readOnly: false,
    inputSchema: {
      type: 'object',
      required: ['bookingId', 'start'],
      properties: { bookingId: { type: 'string' }, start: { type: 'string' }, timezone: { type: 'string' } },
    },
    run: async (ctx, a) => {
      const booking = await ownedBooking(ctx.ws, str(a.bookingId, 64) ?? '');
      if (!booking) throw new CalendarError('not_found', 404);
      if (booking.status !== 'confirmed') throw new CalendarError('not_confirmed', 409);
      const start = new Date(str(a.start, 40) ?? '');
      if (Number.isNaN(start.getTime())) throw new CalendarError('invalid_input', 400);
      const slot = await findOfferedSlot(booking.event_type_id, start, validTz(str(a.timezone, 64) ?? booking.timezone), {
        excludeBookingId: booking.id,
      });
      if (!slot) throw new CalendarError('slot_unavailable', 409);
      const moved = await rescheduleBooking(booking.id, slot.start);
      const synced = await afterBookingRescheduled(moved, booking.host_user_id, undefined, { byHost: true });
      await logCalActivity(ctx.ws, ctx.personId, 'booking.rescheduled', { type: 'booking', id: booking.id, summary: `${booking.invitee_name} (MCP)` });
      return { status: 'confirmed', id: synced.id, startsAt: synced.starts_at, endsAt: synced.ends_at };
    },
  },
];

export function calMcpTools(): Array<{ name: string; title: string; description: string; inputSchema: Json; annotations: Json }> {
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
export async function handleCalRpc(ctx: CalMcpContext, req: RpcRequest): Promise<RpcResponse | null> {
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
          serverInfo: { name: 'zerosoft-cal', title: 'zerosoft Cal', version: '1.0.0' },
          instructions:
            'Scheduling of a zerosoft workspace. Use list_event_types, then get_available_times for a day, then book_meeting. list_bookings finds bookings to cancel_booking or reschedule_booking.',
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: calMcpTools() } };
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
        const code = err instanceof CalendarError ? err.code : 'server_error';
        if (!(err instanceof CalendarError)) {
          // eslint-disable-next-line no-console
          console.error('[cal] mcp tool failed', (err as Error)?.name ?? 'error');
        }
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `Error: ${code}` }] } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}
