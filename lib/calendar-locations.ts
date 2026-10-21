/**
 * Cal — ubicaciones estructuradas de un tipo de evento (puro, sin zod ni DB:
 * lo usan el editor, la página pública y el server).
 *
 * Tipos:
 * - zoom / teams: link fijo. Si la opción no trae uno, se usa el link
 *   personal del anfitrión asignado (Cal → Ajustes). No hay OAuth: el link no
 *   se genera por reunión.
 * - google_meet: lo crea Google Calendar al reservar (si el host lo conectó).
 * - phone_host: el anfitrión llama; el invitado deja su teléfono.
 * - phone_invitee: el invitado llama al número del evento o al del anfitrión.
 * - in_person: dirección fija.
 * - link: cualquier otro link fijo.
 */
import { isValidPhone } from './calendar-questions';

export const LOCATION_KINDS = ['zoom', 'teams', 'google_meet', 'phone_host', 'phone_invitee', 'in_person', 'link'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const MAX_LOCATIONS = 8;
const VALUE_MAX = 500;

export interface LocationOption {
  kind: LocationKind;
  /** Link, dirección o teléfono según el tipo ('' = el del anfitrión o ninguno). */
  value: string;
}

/** Links fijos del anfitrión (calendar_users.conferencing). */
export interface HostConferencing {
  zoomUrl?: string;
  teamsUrl?: string;
  phone?: string;
}

export interface ResolvedLocation {
  kind: LocationKind;
  /** Texto que va a la reserva, los emails y el .ics ('' si no hay). */
  text: string;
}

export function isLocationKind(v: unknown): v is LocationKind {
  return typeof v === 'string' && (LOCATION_KINDS as readonly string[]).includes(v);
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function oneLine(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, VALUE_MAX) : '';
}

/** Tipos cuyo valor es un link (si lo traen, tiene que ser http/https). */
const URL_KINDS: ReadonlySet<LocationKind> = new Set(['zoom', 'teams', 'link']);

/**
 * Problema de una opción (para validar al guardar), o null si sirve. La
 * dirección y el link propio son obligatorios; Zoom y Teams pueden venir sin
 * link (se usa el del anfitrión); el teléfono a llamar, si viene, tiene que
 * ser un teléfono.
 */
export function locationProblem(opt: { kind: string; value?: string }): string | null {
  if (!isLocationKind(opt.kind)) return 'invalid_location';
  const value = oneLine(opt.value);
  if ((opt.kind === 'in_person' || opt.kind === 'link') && !value) return 'missing_location_value';
  if (value && URL_KINDS.has(opt.kind) && !isHttpUrl(value)) return 'invalid_location_url';
  if (value && opt.kind === 'phone_invitee' && !isValidPhone(value)) return 'invalid_location_phone';
  return null;
}

/**
 * Ubicaciones guardadas en el evento (JSON), tolerando datos viejos o rotos.
 * Sin repetir tipo + valor. `validate: false` (la página pública, que recibe
 * las opciones sin sus links) solo descarta tipos desconocidos.
 */
export function parseLocations(json: string | null | undefined, opts: { validate?: boolean } = {}): LocationOption[] {
  let list: unknown;
  try {
    list = JSON.parse(json || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: LocationOption[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (!isLocationKind(r.kind)) continue;
    const opt = { kind: r.kind, value: oneLine(r.value) };
    if (opts.validate !== false && locationProblem(opt)) continue;
    if (out.some((o) => o.kind === opt.kind && o.value === opt.value)) continue;
    out.push(opt);
    if (out.length >= MAX_LOCATIONS) break;
  }
  return out;
}

export function parseConferencing(json: string | null | undefined): HostConferencing {
  let raw: unknown;
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: HostConferencing = {};
  const zoom = oneLine(r.zoomUrl);
  const teams = oneLine(r.teamsUrl);
  const phone = oneLine(r.phone);
  if (zoom && isHttpUrl(zoom)) out.zoomUrl = zoom;
  if (teams && isHttpUrl(teams)) out.teamsUrl = teams;
  if (phone && isValidPhone(phone)) out.phone = phone;
  return out;
}

/** Índice de una opción para identificarla en la página pública (tipo + posición). */
export function locationKey(opt: LocationOption, index: number): string {
  return `${index}:${opt.kind}`;
}

/**
 * Elige la ubicación de una reserva. Sin opciones: null (el evento usa su
 * campo de texto de siempre). Con `choice.key`, tiene que ser una de las
 * opciones. Sin elección (la API o el agente reservan sin preguntar), la
 * primera que no pide datos al invitado. phone_host pide el teléfono del
 * invitado. Devuelve la opción elegida o un código de error.
 */
export function pickLocation(
  options: LocationOption[],
  choice: { key?: string; phone?: string } | undefined,
): { option: LocationOption; phone: string } | { error: string } | null {
  if (options.length === 0) return null;
  let option: LocationOption | undefined;
  if (choice?.key) option = options.find((o, i) => locationKey(o, i) === choice.key);
  else option = choice?.phone ? options[0] : (options.find((o) => o.kind !== 'phone_host') ?? options[0]);
  if (!option) return { error: 'invalid_location' };
  const phone = oneLine(choice?.phone);
  if (option.kind === 'phone_host') {
    if (!phone || !isValidPhone(phone)) return { error: 'invalid_phone' };
    return { option, phone };
  }
  return { option, phone: '' };
}

/**
 * Texto concreto de la ubicación para el anfitrión asignado: el valor de la
 * opción o, si no tiene, el link o teléfono personal del anfitrión.
 */
export function resolveLocation(option: LocationOption, host: HostConferencing, inviteePhone = ''): ResolvedLocation {
  switch (option.kind) {
    case 'zoom':
      return { kind: option.kind, text: option.value || host.zoomUrl || '' };
    case 'teams':
      return { kind: option.kind, text: option.value || host.teamsUrl || '' };
    case 'phone_invitee':
      return { kind: option.kind, text: option.value || host.phone || '' };
    case 'phone_host':
      return { kind: option.kind, text: inviteePhone };
    case 'google_meet':
      // El link lo completa Google Calendar (meeting_url).
      return { kind: option.kind, text: '' };
    default:
      return { kind: option.kind, text: option.value };
  }
}

/**
 * Ubicaciones para la página pública antes de reservar: el tipo y, solo en
 * persona, la dirección. Los links y teléfonos llegan con la confirmación.
 */
export function publicLocationsJson(json: string | null | undefined): string {
  return JSON.stringify(parseLocations(json).map((o) => ({ kind: o.kind, value: o.kind === 'in_person' ? o.value : '' })));
}

/** Es un link que se puede abrir (para mostrarlo como botón). */
export function isJoinableLocation(text: string): boolean {
  return isHttpUrl(text);
}
