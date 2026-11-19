/**
 * HubSpot falso en memoria: una cuenta ("portal") con estado, para tests y
 * demo. Es el único HubSpot falso del repo: el de Lines
 * (lib/groups-hubspot-fake.ts) y el del importador del CRM
 * (lib/crm-import-fake.ts) son esta misma cuenta con otros datos de arranque.
 * Nada sale a internet y los datos son inventados. Server-only.
 *
 * Qué responde (como la API real, hasta donde la usamos):
 * - Info del token para una private app heredada y para una service key
 *   (`serviceKeyTokenInfo` decide si la consulta de private apps la reconoce).
 * - Objetos (contactos, empresas, negocios y notas, llamadas, reuniones,
 *   tareas, emails): listar con cursor y `archived=true`, leer, crear, editar,
 *   archivar, buscar (filtros, orden, paginado y el tope de 10.000
 *   resultados), batch read/create/update/upsert/archive y fusionar.
 * - Reglas de HubSpot: crear un contacto con un email que ya existe es un
 *   409; el upsert de contactos va por email; las empresas no se deduplican
 *   por dominio; un valor que no acepta la propiedad es un 400.
 * - Asociaciones (v4): contacto↔empresa con primaria, negocio↔contacto,
 *   negocio↔empresa y actividades.
 * - Dueños, pipelines con etapas, definición de propiedades con opciones,
 *   grupos de propiedades y listas.
 * - Fallas a pedido: 429 con Retry-After, 423, 5xx y el límite diario; y los
 *   headers X-HubSpot-RateLimit-* si el test los configura.
 *
 * Límites conocidos: no simula el retraso del índice de búsqueda, ni
 * webhooks, ni el historial de propiedades.
 */
import type { FetchLike } from './retry';

export type FakeProps = Record<string, string>;

export interface FakeObject {
  id: string;
  properties: FakeProps;
  /** Notas: `tipo:id` de cada registro asociado (como lo miran los tests de Lines). */
  associations?: string[];
  archivedAt?: string;
}

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
}

export interface FakePropertyDef {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
  hidden?: boolean;
  calculated?: boolean;
  hubspotDefined?: boolean;
  readOnlyValue?: boolean;
  referencedObjectType?: string;
  displayOrder?: number;
  hasUniqueValue?: boolean;
  showCurrencySymbol?: boolean;
  archived?: boolean;
}

export interface FakePropertyGroup {
  name: string;
  label: string;
  displayOrder: number;
}

export interface FakeOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  archived?: boolean;
}

export interface FakeStage {
  id: string;
  label: string;
  /** '0.0' a '1.0', como lo manda HubSpot. */
  probability?: string;
  closed?: boolean;
}

export interface FakePipeline {
  id: string;
  label: string;
  stages: FakeStage[];
}

export interface FakeList {
  listId: string;
  name: string;
  /** '0-1' contactos, '0-2' empresas. */
  objectTypeId: string;
  processingType: string;
  members: string[];
}

export type FakeTokenKind = 'private_app' | 'service_key';

export interface FakeTokenGrant {
  kind: FakeTokenKind;
  /** '*': todos los permisos. */
  scopes: string[] | '*';
  /** Lo que la info del token dice que tiene, si difiere de lo que de verdad puede (una clave vieja con otros nombres). */
  reported?: string[];
}

export interface FakeFault {
  status: number;
  /** Cuántas llamadas más fallan. */
  times: number;
  retryAfter?: string;
  /** 'DAILY' para el límite diario. */
  policyName?: string;
  /** Solo las rutas que contienen este texto. */
  path?: string;
}

export interface FakeRate {
  max: number;
  intervalMs: number;
  remaining: number;
  daily: number;
  dailyRemaining: number;
}

export const FAKE_OBJECT_TYPES = ['contacts', 'companies', 'deals', 'notes', 'calls', 'meetings', 'tasks', 'emails'] as const;
export type FakeObjectType = (typeof FAKE_OBJECT_TYPES)[number];
const isType = (v: string): v is FakeObjectType => (FAKE_OBJECT_TYPES as readonly string[]).includes(v);

export const ALL_FAKE_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.objects.owners.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
  'crm.lists.read',
  'sales-email-read',
];

/** typeId de HubSpot para cada par (el primero es el de la asociación primaria, si existe). */
const ASSOC_TYPES: Record<string, { primary?: number; plain: number }> = {
  'contacts/companies': { primary: 1, plain: 279 },
  'companies/contacts': { primary: 2, plain: 280 },
  'deals/contacts': { plain: 3 },
  'contacts/deals': { plain: 4 },
  'deals/companies': { primary: 5, plain: 341 },
  'companies/deals': { primary: 6, plain: 342 },
  'notes/contacts': { plain: 202 },
  'contacts/notes': { plain: 201 },
  'notes/companies': { plain: 190 },
  'companies/notes': { plain: 189 },
  'notes/deals': { plain: 214 },
  'deals/notes': { plain: 213 },
  'calls/contacts': { plain: 194 },
  'contacts/calls': { plain: 193 },
  'calls/companies': { plain: 182 },
  'companies/calls': { plain: 181 },
  'calls/deals': { plain: 206 },
  'deals/calls': { plain: 205 },
  'meetings/contacts': { plain: 200 },
  'contacts/meetings': { plain: 199 },
  'meetings/companies': { plain: 188 },
  'companies/meetings': { plain: 187 },
  'meetings/deals': { plain: 212 },
  'deals/meetings': { plain: 211 },
  'tasks/contacts': { plain: 204 },
  'contacts/tasks': { plain: 203 },
  'tasks/companies': { plain: 192 },
  'companies/tasks': { plain: 191 },
  'tasks/deals': { plain: 216 },
  'deals/tasks': { plain: 215 },
  'emails/contacts': { plain: 198 },
  'contacts/emails': { plain: 197 },
  'emails/companies': { plain: 186 },
  'companies/emails': { plain: 185 },
  'emails/deals': { plain: 210 },
  'deals/emails': { plain: 209 },
};

interface AssocLink {
  id: string;
  primary: boolean;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const digits = (v: string | undefined) => String(v ?? '').replace(/\D/g, '');
const byId = (a: FakeObject, b: FakeObject) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id);

const NAME_PROPS: Record<string, string[]> = {
  companies: ['name', 'domain'],
  deals: ['dealname'],
  contacts: ['firstname', 'lastname', 'email', 'company'],
};

/** Un valor como número para comparar: fechas en milisegundos, números tal cual. */
function numeric(v: string): number {
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return Date.parse(v);
}

/** Lo que HubSpot diría de un valor que no acepta, o null si lo acepta. */
function invalidValue(def: FakePropertyDef | undefined, name: string, value: string): { message: string; error: string; name: string } | null {
  if (!def) return { message: `Property "${name}" does not exist`, error: 'PROPERTY_DOESNT_EXIST', name };
  if (def.readOnlyValue || def.calculated) return { message: `"${name}" is a read only property; its value cannot be set`, error: 'READ_ONLY_VALUE', name };
  if (value === '') return null;
  if (def.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) return { message: `${value} was not a valid number`, error: 'INVALID_INTEGER', name };
  if (def.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !/^\d{10,14}$/.test(value)) return { message: `${value} was not a valid date`, error: 'INVALID_DATE', name };
  if (def.type === 'datetime' && !Number.isFinite(Date.parse(value)) && !/^\d{10,14}$/.test(value)) return { message: `${value} was not a valid date`, error: 'INVALID_DATE', name };
  if ((def.type === 'enumeration' || def.type === 'bool') && def.options?.length) {
    const bad = value.split(';').find((v) => !def.options?.some((o) => o.value === v));
    if (bad !== undefined) return { message: `${bad} was not one of the allowed options`, error: 'INVALID_OPTION', name };
  }
  return null;
}

/** Una propiedad como la devuelve /crm/v3/properties. */
function toApiProp(d: FakePropertyDef, i: number) {
  return {
    name: d.name,
    label: d.label,
    type: d.type,
    fieldType: d.fieldType,
    description: d.description ?? '',
    groupName: d.groupName,
    options: (d.options ?? []).map((o, n) => ({ ...o, displayOrder: n, hidden: false })),
    displayOrder: d.displayOrder ?? i,
    calculated: d.calculated === true,
    externalOptions: d.referencedObjectType === 'OWNER',
    ...(d.referencedObjectType ? { referencedObjectType: d.referencedObjectType } : {}),
    ...(d.showCurrencySymbol ? { showCurrencySymbol: true } : {}),
    ...(d.archived ? { archived: true } : {}),
    hasUniqueValue: d.hasUniqueValue === true,
    hidden: d.hidden === true,
    hubspotDefined: d.hubspotDefined === true,
    modificationMetadata: { archivable: !d.hubspotDefined, readOnlyDefinition: d.hubspotDefined === true, readOnlyValue: d.readOnlyValue === true },
    formField: !d.hidden,
  };
}

/** El permiso que pide leer o escribir cada objeto. Las actividades van con el de contactos; los emails se leen con el suyo. */
function objectScope(type: string, mode: 'read' | 'write'): string {
  if (type === 'contacts' || type === 'companies' || type === 'deals') return `crm.objects.${type}.${mode}`;
  if (type === 'emails' && mode === 'read') return 'sales-email-read';
  return `crm.objects.contacts.${mode}`;
}

const schemaScope = (type: string) => `crm.schemas.${type === 'companies' || type === 'deals' ? type : 'contacts'}.read`;

type Filter = { propertyName?: string; operator?: string; value?: string; highValue?: string; values?: string[] };

export interface FakePortalOptions {
  portalId?: string;
  uiDomain?: string;
  /** Qué clave vale y con qué permisos. Por defecto: las que empiezan con "pat-" (ver defaultGrant). */
  grant?: (token: string) => FakeTokenGrant | null;
  /** false: escribir no valida contra la definición de las propiedades. */
  validate?: boolean;
}

/**
 * Claves del HubSpot falso por defecto: cualquiera que empiece con "pat-".
 * Con "svc" es una service key (si no, una private app heredada). "noscope"
 * solo lee contactos; "readonly" lee todo y no escribe; "noobjschema" no lee
 * la definición de contactos ni negocios; "nolists" y "noemail" no tienen
 * esos dos permisos.
 */
export function defaultGrant(token: string): FakeTokenGrant | null {
  if (!token.startsWith('pat-')) return null;
  const kind: FakeTokenKind = token.includes('svc') ? 'service_key' : 'private_app';
  const write = ALL_FAKE_SCOPES.filter((s) => s.endsWith('.write'));
  const extra = ['crm.lists.read', 'sales-email-read'];
  const read = ALL_FAKE_SCOPES.filter((s) => !write.includes(s) && !extra.includes(s));
  if (token.includes('noscope')) return { kind, scopes: ['crm.objects.contacts.read'] };
  if (token.includes('readonly')) return { kind, scopes: read };
  if (token.includes('noobjschema')) return { kind, scopes: [...read.filter((s) => s !== 'crm.schemas.contacts.read' && s !== 'crm.schemas.deals.read'), ...write] };
  return { kind, scopes: [...read, ...write] };
}

export class FakeHubspotPortal {
  portalId: string;
  uiDomain: string;
  calls: FakeCall[] = [];
  objects: Record<FakeObjectType, Map<string, FakeObject>>;
  archived: Record<FakeObjectType, Map<string, FakeObject>>;
  props: Record<string, FakePropertyDef[]> = {};
  propGroups: Record<string, FakePropertyGroup[]> = {};
  owners = new Map<string, FakeOwner>();
  pipelines: FakePipeline[] = [];
  lists: FakeList[] = [];
  /** `de/a` → id de origen → destinos. */
  assoc = new Map<string, Map<string, AssocLink[]>>();
  /** Por tipo: registro fusionado → el que quedó. */
  mergedInto: Record<string, Map<string, string>> = {};
  seq = 5000;
  /** Reloj de HubSpot: nunca retrocede y cada cambio tiene su milisegundo. */
  clock = 0;
  /** Las próximas N llamadas autenticadas responden 429 (con Retry-After: 1). */
  rateLimit = 0;
  faults: FakeFault[] = [];
  /** Con esto, cada respuesta (menos la búsqueda) lleva los headers X-HubSpot-RateLimit-*. */
  rate: FakeRate | null = null;
  /** La búsqueda no devuelve más allá de este resultado (10.000 en HubSpot). */
  searchCap = 10_000;
  /** Qué dice la consulta de info de private apps de una service key. HubSpot no lo documenta. */
  serviceKeyTokenInfo: 'unsupported' | 'supported' = 'unsupported';
  /**
   * Fusionar por la API: empresas y negocios quedan en un registro nuevo con otro
   * id, y los dos anteriores van a hs_merged_object_ids (como hace HubSpot desde
   * 2025). Los contactos conservan siempre el id del principal. false: empresas
   * y negocios también conservan el id del principal (el comportamiento viejo).
   */
  mergeCreatesNewRecord = true;
  validate: boolean;
  grant: (token: string) => FakeTokenGrant | null;

  constructor(opts: FakePortalOptions = {}) {
    this.portalId = opts.portalId ?? '424242';
    this.uiDomain = opts.uiDomain ?? 'app.hubspot.com';
    this.grant = opts.grant ?? defaultGrant;
    this.validate = opts.validate !== false;
    const maps = () => Object.fromEntries(FAKE_OBJECT_TYPES.map((t) => [t, new Map<string, FakeObject>()])) as Record<FakeObjectType, Map<string, FakeObject>>;
    this.objects = maps();
    this.archived = maps();
  }

  // ---------- Vistas que usan los tests de Lines ----------

  get companies() {
    return this.objects.companies;
  }
  get contacts() {
    return this.objects.contacts;
  }
  get deals() {
    return this.objects.deals;
  }
  get notes() {
    return this.objects.notes as Map<string, FakeObject & { associations: string[] }>;
  }
  get companyProps() {
    return (this.props.companies ??= []);
  }
  set companyProps(v: FakePropertyDef[]) {
    this.props.companies = v;
  }
  get contactProps() {
    return (this.props.contacts ??= []);
  }
  set contactProps(v: FakePropertyDef[]) {
    this.props.contacts = v;
  }
  get dealProps() {
    return (this.props.deals ??= []);
  }
  set dealProps(v: FakePropertyDef[]) {
    this.props.deals = v;
  }
  /** Empresa fusionada → la que quedó. */
  get merged() {
    return (this.mergedInto.companies ??= new Map());
  }

  // ---------- Editar "desde HubSpot" ----------

  /** La hora de HubSpot para un cambio: la real, pero siempre un milisegundo después de la anterior. */
  tick(): string {
    this.clock = Math.max(Date.now(), this.clock + 1);
    return new Date(this.clock).toISOString();
  }

  private touch(type: FakeObjectType, o: FakeObject): string {
    const at = this.tick();
    o.properties.hs_lastmodifieddate = at;
    if (type === 'contacts') o.properties.lastmodifieddate = at;
    return at;
  }

  /** Agrega un registro como si se creara en HubSpot (con id, fecha de alta y de modificación). Devuelve su id. */
  add(type: FakeObjectType, properties: FakeProps = {}, id?: string): string {
    const newId = id ?? String(++this.seq);
    const o: FakeObject = { id: newId, properties: { ...properties, hs_object_id: newId } };
    const at = this.touch(type, o);
    o.properties.createdate = properties.createdate ?? at;
    if (type === 'notes') o.associations = [];
    this.objects[type].set(newId, o);
    return newId;
  }

  /** "Alguien editó el registro en HubSpot": cambia propiedades y la fecha de modificación. Devuelve esa fecha. */
  edit(type: FakeObjectType, id: string, properties: FakeProps): string {
    const o = this.objects[type].get(id);
    if (!o) throw new Error(`fake ${type} ${id}`);
    Object.assign(o.properties, properties);
    return this.touch(type, o);
  }

  /** Archiva (borra) un registro: deja de listarse y aparece con `archived=true`. */
  archive(type: FakeObjectType, id: string): boolean {
    const o = this.objects[type].get(id);
    if (!o) return false;
    this.objects[type].delete(id);
    o.archivedAt = this.touch(type, o);
    this.archived[type].set(id, o);
    return true;
  }

  restore(type: FakeObjectType, id: string): boolean {
    const o = this.archived[type].get(id);
    if (!o) return false;
    this.archived[type].delete(id);
    delete o.archivedAt;
    this.touch(type, o);
    this.objects[type].set(id, o);
    return true;
  }

  /**
   * Fusiona `loserId` en `winnerId` como HubSpot: el primero deja de existir y
   * el que queda guarda su id en hs_merged_object_ids. Con `newRecord` queda
   * un registro con id nuevo (los dos anteriores apuntan a él). Devuelve el id
   * que quedó.
   */
  merge(type: FakeObjectType, loserId: string, winnerId: string, opts: { newRecord?: boolean } = {}): string {
    const table = this.objects[type];
    const winner = table.get(winnerId);
    const loser = table.get(loserId);
    if (!winner || !loser || loserId === winnerId) throw new Error('fake merge');
    const into = (this.mergedInto[type] ??= new Map());
    let kept = winner;
    const mergedIds = [...(winner.properties.hs_merged_object_ids ?? '').split(';').filter(Boolean), loserId];
    table.delete(loserId);
    if (opts.newRecord) {
      const id = String(++this.seq);
      kept = { id, properties: { ...winner.properties, hs_object_id: id } };
      table.delete(winnerId);
      table.set(id, kept);
      mergedIds.push(winnerId);
      into.set(winnerId, id);
      for (const [from, to] of into) if (to === winnerId) into.set(from, id);
    }
    into.set(loserId, kept.id);
    // Las asociaciones de los que dejaron de existir pasan al que quedó.
    for (const gone of opts.newRecord ? [loserId, winnerId] : [loserId]) {
      for (const [key, links] of this.assoc) {
        const [from, to] = key.split('/');
        if (from === type) {
          const mine = links.get(gone);
          if (mine) {
            links.delete(gone);
            for (const l of mine) this.link(key, kept.id, l.id, false);
          }
        }
        if (to === type) {
          for (const [fromId, list] of links) {
            for (const l of list) if (l.id === gone) l.id = kept.id;
            // Si ya estaba asociado al que quedó, no queda dos veces.
            const seen = new Map<string, AssocLink>();
            for (const l of list) {
              const prev = seen.get(l.id);
              if (prev) prev.primary = prev.primary || l.primary;
              else seen.set(l.id, l);
            }
            if (seen.size !== list.length) links.set(fromId, [...seen.values()]);
          }
        }
      }
    }
    kept.properties.hs_merged_object_ids = mergedIds.join(';');
    this.touch(type, kept);
    return kept.id;
  }

  private link(key: string, fromId: string, toId: string, primary: boolean): void {
    let table = this.assoc.get(key);
    if (!table) this.assoc.set(key, (table = new Map()));
    let list = table.get(fromId);
    if (!list) table.set(fromId, (list = []));
    if (primary) for (const l of list) l.primary = false;
    const hit = list.find((l) => l.id === toId);
    if (hit) hit.primary = hit.primary || primary;
    else list.push({ id: toId, primary });
  }

  /** Asocia dos registros (en los dos sentidos). `primary`: la empresa principal de un contacto o de un negocio. */
  associate(from: FakeObjectType, fromId: string, to: FakeObjectType, toId: string, opts: { primary?: boolean } = {}): void {
    const primary = opts.primary === true && ASSOC_TYPES[`${from}/${to}`]?.primary !== undefined;
    this.link(`${from}/${to}`, fromId, toId, primary);
    this.link(`${to}/${from}`, toId, fromId, false);
    if (from === 'contacts' && to === 'companies' && primary) {
      const c = this.objects.contacts.get(fromId);
      if (c) c.properties.associatedcompanyid = toId;
    }
    if (from === 'notes' || to === 'notes') {
      const [noteId, otherType, otherId] = from === 'notes' ? [fromId, to, toId] : [toId, from, fromId];
      const note = this.objects.notes.get(noteId);
      if (note) {
        note.associations ??= [];
        if (!note.associations.includes(`${otherType}:${otherId}`)) note.associations.push(`${otherType}:${otherId}`);
      }
    }
  }

  dissociate(from: FakeObjectType, fromId: string, to: FakeObjectType, toId: string): void {
    for (const [key, a, b] of [
      [`${from}/${to}`, fromId, toId],
      [`${to}/${from}`, toId, fromId],
    ] as const) {
      const list = this.assoc.get(key)?.get(a);
      if (list) this.assoc.get(key)!.set(a, list.filter((l) => l.id !== b));
    }
    if (from === 'contacts' && to === 'companies') {
      const c = this.objects.contacts.get(fromId);
      if (c && c.properties.associatedcompanyid === toId) c.properties.associatedcompanyid = '';
    }
  }

  /** Los destinos asociados que todavía existen, con sus tipos de asociación como los manda la v4. */
  associated(from: string, fromId: string, to: string) {
    const types = ASSOC_TYPES[`${from}/${to}`] ?? { plain: 0 };
    const live = isType(to) ? this.objects[to] : new Map<string, FakeObject>();
    return (this.assoc.get(`${from}/${to}`)?.get(fromId) ?? [])
      .filter((l) => live.has(l.id))
      .map((l) => ({
        toObjectId: /^\d+$/.test(l.id) ? Number(l.id) : l.id,
        associationTypes: [
          ...(l.primary && types.primary !== undefined ? [{ category: 'HUBSPOT_DEFINED', typeId: types.primary, label: 'Primary' }] : []),
          { category: 'HUBSPOT_DEFINED', typeId: types.plain, label: null },
        ],
      }));
  }

  /** Las próximas `times` llamadas (a las rutas que contengan `path`, si se pasa) responden con ese status. */
  fail(status: number, times = 1, opts: { retryAfter?: string; policyName?: string; path?: string } = {}): void {
    this.faults.push({ status, times, ...opts });
  }

  // ---------- HTTP ----------

  readonly fetch: FetchLike = async (url, init) => this.handle(url, init);

  private find(type: FakeObjectType, id: string): FakeObject | undefined {
    return this.objects[type].get(id) ?? this.objects[type].get(this.mergedInto[type]?.get(id) ?? '');
  }

  private propValue(o: FakeObject, name: string): string {
    // Las hs_searchable_calculated_* son el teléfono solo con dígitos.
    if (name === 'hs_searchable_calculated_phone_number') return digits(o.properties.phone);
    if (name === 'hs_searchable_calculated_mobile_number') return digits(o.properties.mobilephone);
    if (name === 'hs_object_id') return o.id;
    return o.properties[name] ?? '';
  }

  private matches(o: FakeObject, f: Filter): boolean {
    const have = this.propValue(o, String(f.propertyName ?? ''));
    const want = String(f.value ?? '');
    if (f.operator === 'NOT_HAS_PROPERTY') return !have;
    if (f.operator === 'HAS_PROPERTY') return Boolean(have);
    if (f.operator === 'NEQ') return have.toLowerCase() !== want.toLowerCase();
    if (f.operator === 'NOT_IN') return !(f.values ?? []).map(String).includes(have);
    if (!have) return false;
    if (f.operator === 'EQ') return have.toLowerCase() === want.toLowerCase();
    if (f.operator === 'IN') return (f.values ?? []).map(String).includes(have);
    if (f.operator === 'GTE' || f.operator === 'GT' || f.operator === 'LTE' || f.operator === 'LT' || f.operator === 'BETWEEN') {
      const a = numeric(have);
      const b = numeric(want);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (f.operator === 'BETWEEN') {
        const hi = numeric(String(f.highValue ?? ''));
        return Number.isFinite(hi) && a >= b && a <= hi;
      }
      return f.operator === 'GTE' ? a >= b : f.operator === 'GT' ? a > b : f.operator === 'LTE' ? a <= b : a < b;
    }
    if (f.operator === 'CONTAINS_TOKEN' || f.operator === 'NOT_CONTAINS_TOKEN') {
      const core = want.replace(/^\*|\*$/g, '').toLowerCase();
      // Como HubSpot: el valor se parte en tokens; un teléfono con espacios no coincide entero.
      const tokens = have.toLowerCase().split(/[\s();-]+/).filter(Boolean);
      const hit = tokens.some((tk) => (want.startsWith('*') ? tk.replace(/^\+/, '').endsWith(core) : want.endsWith('*') ? tk.startsWith(core) : tk === core));
      return f.operator === 'CONTAINS_TOKEN' ? hit : !hit;
    }
    return false;
  }

  /** Las propiedades pedidas; como HubSpot, una pedida y sin valor vuelve como null. */
  private pick(o: FakeObject, properties: string[]) {
    const out: Record<string, string | null> = {};
    for (const p of properties) out[p] = o.properties[p] === undefined || o.properties[p] === '' ? null : o.properties[p];
    return {
      id: o.id,
      properties: out,
      ...(o.properties.createdate ? { createdAt: o.properties.createdate } : {}),
      ...(o.properties.hs_lastmodifieddate ? { updatedAt: o.properties.hs_lastmodifieddate } : {}),
      archived: Boolean(o.archivedAt),
      ...(o.archivedAt ? { archivedAt: o.archivedAt } : {}),
    };
  }

  /** Como el batch de HubSpot: una propiedad pedida y sin valor vuelve como null. */
  private batchRow(o: FakeObject, properties: string[]) {
    const props: Record<string, string | null> = {};
    for (const p of properties) props[p] = o.properties[p] === undefined || o.properties[p] === '' ? null : o.properties[p];
    return { id: o.id, properties: props, updatedAt: o.properties.hs_lastmodifieddate ?? o.properties.createdate ?? '2026-01-15T12:00:00.000Z' };
  }

  private problems(type: FakeObjectType, patch: FakeProps) {
    const defs = this.props[type];
    if (!this.validate || !defs?.length) return [];
    return Object.entries(patch)
      .map(([name, value]) => invalidValue(defs.find((d) => d.name === name), name, String(value ?? '')))
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  private invalid(problems: Array<{ message: string; error: string; name: string }>) {
    return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: `Property values were not valid: ${JSON.stringify(problems.map((x) => ({ isValid: false, ...x })))}` });
  }

  private emailOwner(email: string, exceptId = ''): FakeObject | undefined {
    const e = email.trim().toLowerCase();
    if (!e) return undefined;
    return [...this.objects.contacts.values()].find((c) => c.id !== exceptId && (c.properties.email ?? '').trim().toLowerCase() === e);
  }

  private conflict(existing: FakeObject) {
    return json(409, { status: 'error', category: 'CONFLICT', message: `Contact already exists. Existing ID: ${existing.id}` });
  }

  private create(type: FakeObjectType, body: Record<string, unknown>): FakeObject {
    const props: FakeProps = {};
    for (const [k, v] of Object.entries((body.properties ?? {}) as Record<string, unknown>)) props[k] = String(v ?? '');
    const id = String(++this.seq);
    const o: FakeObject = { id, properties: props };
    if (type === 'notes') o.associations = [];
    this.objects[type].set(id, o);
    const links = Array.isArray(body.associations) ? (body.associations as Array<{ to?: { id?: unknown }; types?: Array<{ associationTypeId?: number }> }>) : [];
    for (const a of links) {
      const toId = String(a.to?.id ?? '');
      const typeId = Number(a.types?.[0]?.associationTypeId);
      // El destino sale del typeId (190 nota→empresa…); sin typeId conocido, de dónde exista ese id.
      const pair = Object.entries(ASSOC_TYPES).find(([key, t]) => key.startsWith(`${type}/`) && (t.plain === typeId || t.primary === typeId));
      const to = pair ? pair[0].split('/')[1] : FAKE_OBJECT_TYPES.find((t) => t !== type && this.objects[t].has(toId));
      if (!to || !isType(to) || !toId) continue;
      const primary = type === 'contacts' && to === 'companies' && this.objects.companies.has(toId) && !props.associatedcompanyid;
      this.associate(type, id, to, toId, { primary: primary || (pair ? pair[1].primary === typeId : false) });
      // El contacto creado con su empresa muestra el nombre de esa empresa.
      if (primary) props.company = this.objects.companies.get(toId)?.properties.name ?? '';
    }
    return o;
  }

  private stamp(type: FakeObjectType, o: FakeObject): void {
    o.properties.hs_object_id = o.id;
    const at = this.touch(type, o);
    o.properties.createdate ??= at;
  }

  private rateHeaders(search: boolean): Record<string, string> {
    if (!this.rate || search) return {};
    const r = this.rate;
    r.remaining = Math.max(0, r.remaining - 1);
    r.dailyRemaining = Math.max(0, r.dailyRemaining - 1);
    return {
      'x-hubspot-ratelimit-max': String(r.max),
      'x-hubspot-ratelimit-interval-milliseconds': String(r.intervalMs),
      'x-hubspot-ratelimit-remaining': String(r.remaining),
      'x-hubspot-ratelimit-daily': String(r.daily),
      'x-hubspot-ratelimit-daily-remaining': String(r.dailyRemaining),
    };
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    const u = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> = {};
    try {
      body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
    // El token nunca queda en el registro de llamadas.
    this.calls.push({ method, path: u.pathname, body: u.pathname.includes('access-token-info') ? {} : body });
    if (this.calls.length > 500) this.calls.splice(0, 100);
    if (u.hostname !== 'api.hubapi.com') return json(404, { message: 'not found' });

    // Las fallas a pedido valen para cualquier llamada, también la de info del token.
    const fault = this.faults.find((f) => f.times > 0 && (!f.path || u.pathname.includes(f.path)));
    if (fault) {
      fault.times--;
      this.faults = this.faults.filter((f) => f.times > 0);
      const policyName = fault.policyName ?? 'TEN_SECONDLY_ROLLING';
      const payload =
        fault.status === 429
          ? { status: 'error', message: policyName === 'DAILY' ? 'You have reached your daily limit.' : 'You have reached your ten_secondly_rolling limit.', errorType: 'RATE_LIMIT', policyName }
          : { status: 'error', message: fault.status === 423 ? 'Locked' : 'internal error', category: fault.status === 423 ? 'LOCKED' : 'INTERNAL_ERROR' };
      return json(fault.status, payload, fault.retryAfter !== undefined ? { 'retry-after': fault.retryAfter } : {});
    }
    if (u.pathname === '/oauth/v2/private-apps/get/access-token-info') {
      const grant = this.grant(String(body.tokenKey ?? ''));
      if (!grant) return json(401, { category: 'INVALID_AUTHENTICATION' });
      if (grant.kind === 'service_key' && this.serviceKeyTokenInfo === 'unsupported') return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: 'Not a private app access token' });
      const scopes = grant.reported ?? (grant.scopes === '*' ? [...ALL_FAKE_SCOPES] : grant.scopes);
      return json(200, { hubId: Number(this.portalId), userId: 1, ...(grant.kind === 'private_app' ? { appId: 1 } : {}), scopes });
    }

    const headers = new Headers(init?.headers);
    const grant = this.grant((headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
    if (!grant) return json(401, { category: 'INVALID_AUTHENTICATION' });
    const need = (scope: string) => (grant.scopes === '*' || grant.scopes.includes(scope) ? null : json(403, { category: 'MISSING_SCOPES' }));
    if (this.rateLimit > 0) {
      this.rateLimit--;
      return json(429, { status: 'error', errorType: 'RATE_LIMIT', policyName: 'TEN_SECONDLY_ROLLING' }, { 'retry-after': '1' });
    }
    const isSearchPath = u.pathname.endsWith('/search');
    const res = this.route(u, method, body, need);
    const extra = this.rateHeaders(isSearchPath);
    for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
    return res;
  }

  private route(u: URL, method: string, body: Record<string, unknown>, need: (scope: string) => Response | null): Response {
    const path = u.pathname;
    const limitOf = (def: number, max: number) => Math.max(1, Math.min(Number(u.searchParams.get('limit')) || def, max));
    if (path === '/account-info/v3/details') return json(200, { portalId: Number(this.portalId), uiDomain: this.uiDomain });

    // ----- Propiedades -----
    const props = /^\/crm\/v3\/properties\/([a-z]+)(?:\/(.+))?$/.exec(path);
    if (props && method === 'GET') {
      const denied = need(schemaScope(props[1]));
      if (denied) return denied;
      const defs = this.props[props[1]] ?? [];
      if (props[2] === 'groups') return json(200, { results: (this.propGroups[props[1]] ?? []).map((g) => ({ ...g, archived: false })) });
      const wantArchived = u.searchParams.get('archived') === 'true';
      if (!props[2]) return json(200, { results: defs.map(toApiProp).filter((p, i) => Boolean(defs[i].archived) === wantArchived) });
      const one = defs.findIndex((d) => d.name === props[2]);
      return one >= 0 ? json(200, toApiProp(defs[one], one)) : json(404, { category: 'OBJECT_NOT_FOUND' });
    }

    // ----- Dueños -----
    if (path === '/crm/v3/owners' && method === 'GET') {
      const denied = need('crm.objects.owners.read');
      if (denied) return denied;
      const wantArchived = u.searchParams.get('archived') === 'true';
      const email = (u.searchParams.get('email') ?? '').toLowerCase();
      const rows = [...this.owners.values()].filter((o) => Boolean(o.archived) === wantArchived && (!email || o.email.toLowerCase() === email));
      const after = Math.max(0, Number(u.searchParams.get('after')) || 0);
      const limit = limitOf(100, 500);
      return json(200, {
        results: rows.slice(after, after + limit).map((o) => ({ id: o.id, email: o.email, firstName: o.firstName, lastName: o.lastName, archived: Boolean(o.archived) })),
        ...(after + limit < rows.length ? { paging: { next: { after: String(after + limit) } } } : {}),
      });
    }
    const owner = /^\/crm\/v3\/owners\/(\d+)$/.exec(path);
    if (owner && method === 'GET') {
      const denied = need('crm.objects.owners.read');
      if (denied) return denied;
      const o = this.owners.get(owner[1]);
      return o ? json(200, { id: o.id, email: o.email, firstName: o.firstName, lastName: o.lastName, archived: Boolean(o.archived) }) : json(404, { category: 'OBJECT_NOT_FOUND' });
    }

    // ----- Pipelines -----
    const pipe = /^\/crm\/v3\/pipelines\/deals(?:\/([^/]+))?(\/stages)?$/.exec(path);
    if (pipe && method === 'GET') {
      const denied = need('crm.objects.deals.read');
      if (denied) return denied;
      const api = this.pipelines.map((p, i) => ({
        id: p.id,
        label: p.label,
        displayOrder: i,
        archived: false,
        stages: p.stages.map((s, n) => ({
          id: s.id,
          label: s.label,
          displayOrder: n,
          archived: false,
          metadata: { probability: s.probability ?? '0.5', isClosed: String(s.closed === true) },
        })),
      }));
      if (!pipe[1]) return json(200, { results: api });
      const one = api.find((p) => p.id === pipe[1]);
      if (!one) return json(404, { category: 'OBJECT_NOT_FOUND' });
      return pipe[2] ? json(200, { results: one.stages }) : json(200, one);
    }

    // ----- Listas -----
    if (path === '/crm/v3/lists/search' && method === 'POST') {
      const denied = need('crm.lists.read');
      if (denied) return denied;
      const start = Number(body.offset) || 0;
      const count = Number(body.count) || 20;
      const lists = this.lists.map((l) => ({ listId: l.listId, name: l.name, objectTypeId: l.objectTypeId, processingType: l.processingType, size: l.members.length }));
      return json(200, { lists: lists.slice(start, start + count), hasMore: start + count < lists.length, offset: start + count, total: lists.length });
    }
    const members = /^\/crm\/v3\/lists\/(\w+)\/memberships$/.exec(path);
    if (members && method === 'GET') {
      const denied = need('crm.lists.read');
      if (denied) return denied;
      const rows = this.lists.find((l) => l.listId === members[1])?.members ?? [];
      const after = Math.max(0, Number(u.searchParams.get('after')) || 0);
      const limit = limitOf(100, 250);
      return json(200, {
        results: rows.slice(after, after + limit).map((recordId) => ({ recordId, membershipTimestamp: '2026-01-01T00:00:00.000Z' })),
        ...(after + limit < rows.length ? { paging: { next: { after: String(after + limit) } } } : {}),
      });
    }

    // ----- Asociaciones (v4) -----
    const assocBatch = /^\/crm\/v4\/associations\/([a-z]+)\/([a-z]+)\/batch\/(read|create|archive)$/.exec(path);
    if (assocBatch && method === 'POST') {
      const [, from, to, op] = assocBatch;
      if (!isType(from) || !isType(to)) return json(404, { message: 'not found' });
      const denied = need(objectScope(from, 'read')) ?? need(objectScope(to, 'read')) ?? (op === 'read' ? null : need(objectScope(from, 'write')));
      if (denied) return denied;
      const inputs = Array.isArray(body.inputs) ? (body.inputs as Array<Record<string, unknown>>) : [];
      if (op !== 'read' && inputs.length > 100) return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: 'The maximum number of inputs supported in a batch request is 100' });
      if (op === 'read') {
        if (inputs.length > 1000) return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: 'The maximum number of inputs supported in a batch request is 1000' });
        const results = inputs
          .map((i) => String(i?.id ?? ''))
          .map((id) => ({ from: { id }, to: this.associated(from, id, to) }))
          .filter((r) => r.to.length > 0);
        return json(200, { status: 'COMPLETE', results });
      }
      for (const i of inputs) {
        const a = String((i.from as { id?: unknown } | undefined)?.id ?? '');
        const b = String((i.to as { id?: unknown } | undefined)?.id ?? '');
        if (!this.objects[from].has(a) || !this.objects[to].has(b)) continue;
        if (op === 'archive') this.dissociate(from, a, to, b);
        else {
          const typeIds = (Array.isArray(i.types) ? (i.types as Array<{ associationTypeId?: number }>) : []).map((t) => Number(t.associationTypeId));
          this.associate(from, a, to, b, { primary: typeIds.includes(ASSOC_TYPES[`${from}/${to}`]?.primary ?? -1) });
        }
      }
      return op === 'archive' ? json(204, null) : json(201, { status: 'COMPLETE', results: [] });
    }
    const assocOne = /^\/crm\/v4\/objects\/([a-z]+)\/(\d+)\/associations\/(default\/)?([a-z]+)(?:\/(\d+))?$/.exec(path);
    if (assocOne) {
      const [, from, fromId, isDefault, to, toId] = assocOne;
      if (!isType(from) || !isType(to)) return json(404, { message: 'not found' });
      if (method === 'GET' && !toId && !isDefault) {
        const denied = need(objectScope(to, 'read'));
        if (denied) return denied;
        return json(200, { results: this.associated(from, fromId, to) });
      }
      const denied = need(objectScope(from, 'write'));
      if (denied) return denied;
      if (!toId || !this.objects[from].has(fromId)) return json(404, { category: 'OBJECT_NOT_FOUND' });
      if (method === 'PUT') {
        if (!this.objects[to].has(toId)) return json(404, { category: 'OBJECT_NOT_FOUND' });
        const typeIds = (Array.isArray(body) ? (body as Array<{ associationTypeId?: number }>) : []).map((t) => Number(t.associationTypeId));
        this.associate(from, fromId, to, toId, { primary: typeIds.includes(ASSOC_TYPES[`${from}/${to}`]?.primary ?? -1) });
        return json(200, { status: 'COMPLETE' });
      }
      if (method === 'DELETE') {
        this.dissociate(from, fromId, to, toId);
        return json(204, null);
      }
    }

    // ----- Objetos -----
    const objects = /^\/crm\/v3\/objects\/([a-z]+)(?:\/(.+))?$/.exec(path);
    if (!objects || !isType(objects[1])) return json(404, { message: 'not found' });
    const type = objects[1];
    const sub = objects[2] ?? '';
    const table = this.objects[type];
    const denied = need(objectScope(type, 'read'));
    if (denied) return denied;
    const writeDenied = () => need(objectScope(type, 'write'));
    const inputs = Array.isArray(body.inputs) ? (body.inputs as Array<Record<string, unknown>>) : [];
    const wanted = Array.isArray(body.properties) ? (body.properties as string[]) : [];
    const tooMany = () => json(400, { status: 'error', category: 'VALIDATION_ERROR', message: 'The maximum number of inputs supported in a batch request is 100' });

    if (sub === 'batch/read' && method === 'POST') {
      if (inputs.length > 100) return tooMany();
      const idProperty = typeof body.idProperty === 'string' ? body.idProperty : '';
      const results: Array<ReturnType<FakeHubspotPortal['batchRow']>> = [];
      const missing: string[] = [];
      const sent = new Set<string>();
      for (const input of inputs) {
        const key = String(input?.id ?? '');
        // Un registro fusionado devuelve el que quedó (con su propio id).
        const o = idProperty && idProperty !== 'hs_object_id' ? [...table.values()].find((x) => (x.properties[idProperty] ?? '').toLowerCase() === key.toLowerCase() && key !== '') : this.find(type, key);
        if (!o) {
          missing.push(key);
          continue;
        }
        if (sent.has(o.id)) continue;
        sent.add(o.id);
        results.push(this.batchRow(o, wanted));
      }
      if (missing.length === 0) return json(200, { status: 'COMPLETE', results });
      return json(207, { status: 'COMPLETE', results, numErrors: 1, errors: [{ status: 'error', category: 'OBJECT_NOT_FOUND', message: `Could not get some ${type} objects, they may be deleted or not exist.`, context: { ids: missing } }] });
    }

    if (sub === 'batch/create' && method === 'POST') {
      const noWrite = writeDenied();
      if (noWrite) return noWrite;
      if (inputs.length > 100) return tooMany();
      const all = inputs.map((i) => (i.properties ?? {}) as FakeProps);
      const bad = all.flatMap((p) => this.problems(type, p));
      if (bad.length) return this.invalid(bad);
      if (type === 'contacts') {
        const seen = new Set<string>();
        for (const p of all) {
          const email = String(p.email ?? '').trim().toLowerCase();
          const existing = this.emailOwner(email);
          if (existing) return this.conflict(existing);
          if (email && seen.has(email)) return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: 'Duplicate email in the batch' });
          if (email) seen.add(email);
        }
      }
      const results = inputs.map((i) => {
        const o = this.create(type, i);
        this.stamp(type, o);
        return this.pick(o, Object.keys(o.properties));
      });
      return json(201, { status: 'COMPLETE', results });
    }

    if (sub === 'batch/update' && method === 'POST') {
      const noWrite = writeDenied();
      if (noWrite) return noWrite;
      if (inputs.length > 100) return tooMany();
      const bad = inputs.flatMap((i) => this.problems(type, (i.properties ?? {}) as FakeProps));
      if (bad.length) return this.invalid(bad);
      const results: unknown[] = [];
      const missing: string[] = [];
      for (const i of inputs) {
        const o = this.find(type, String(i.id ?? ''));
        if (!o) {
          missing.push(String(i.id ?? ''));
          continue;
        }
        const patch = (i.properties ?? {}) as FakeProps;
        if (type === 'contacts' && patch.email) {
          const other = this.emailOwner(String(patch.email), o.id);
          if (other) return this.conflict(other);
        }
        for (const [k, v] of Object.entries(patch)) o.properties[k] = String(v ?? '');
        const at = this.touch(type, o);
        results.push({ id: o.id, properties: { ...patch, hs_lastmodifieddate: at }, updatedAt: at });
      }
      if (missing.length === 0) return json(200, { status: 'COMPLETE', results });
      return json(207, { status: 'COMPLETE', results, numErrors: 1, errors: [{ status: 'error', category: 'OBJECT_NOT_FOUND', message: 'Could not update some objects.', context: { ids: missing } }] });
    }

    if (sub === 'batch/upsert' && method === 'POST') {
      const noWrite = writeDenied();
      if (noWrite) return noWrite;
      if (inputs.length > 100) return tooMany();
      const results: unknown[] = [];
      for (const i of inputs) {
        const idProperty = String(i.idProperty ?? '');
        const unique = (type === 'contacts' && idProperty === 'email') || (this.props[type] ?? []).some((d) => d.name === idProperty && d.hasUniqueValue);
        // Solo se puede hacer upsert por una propiedad de valor único (en contactos, el email).
        if (!unique) return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: `Property ${idProperty || '(none)'} is not a unique value property` });
      }
      const bad = inputs.flatMap((i) => this.problems(type, (i.properties ?? {}) as FakeProps));
      if (bad.length) return this.invalid(bad);
      for (const i of inputs) {
        const idProperty = String(i.idProperty);
        const key = String(i.id ?? '').trim().toLowerCase();
        const patch = (i.properties ?? {}) as FakeProps;
        let o = key ? [...table.values()].find((x) => (x.properties[idProperty] ?? '').trim().toLowerCase() === key) : undefined;
        const isNew = !o;
        if (!o) {
          o = this.create(type, { properties: { ...patch, [idProperty]: String(i.id ?? '') } });
          this.stamp(type, o);
        } else {
          for (const [k, v] of Object.entries(patch)) o.properties[k] = String(v ?? '');
          this.touch(type, o);
        }
        results.push({ ...this.pick(o, Object.keys(o.properties)), new: isNew });
      }
      return json(200, { status: 'COMPLETE', results });
    }

    if (sub === 'batch/archive' && method === 'POST') {
      const noWrite = writeDenied();
      if (noWrite) return noWrite;
      if (inputs.length > 100) return tooMany();
      for (const i of inputs) this.archive(type, String(i.id ?? ''));
      return json(204, null);
    }

    if (sub === 'merge' && method === 'POST') {
      const noWrite = writeDenied();
      if (noWrite) return noWrite;
      const winner = String(body.primaryObjectId ?? '');
      const loser = String(body.objectIdToMerge ?? '');
      if (!table.has(winner) || !table.has(loser) || winner === loser) return json(404, { category: 'OBJECT_NOT_FOUND' });
      const id = this.merge(type, loser, winner, { newRecord: this.mergeCreatesNewRecord && type !== 'contacts' });
      const o = table.get(id)!;
      return json(200, this.pick(o, Object.keys(o.properties)));
    }

    if (sub === 'search' && method === 'POST') {
      const limit = Math.max(1, Math.min(Number(body.limit) || 10, 200));
      const q = String(body.query ?? '').trim().toLowerCase();
      const groups = Array.isArray(body.filterGroups) ? (body.filterGroups as Array<{ filters?: Filter[] }>) : [];
      // Los topes de la búsqueda de HubSpot: 5 grupos, 6 filtros por grupo y 18 en total.
      const total = groups.reduce((n, g) => n + (g.filters?.length ?? 0), 0);
      if (groups.length > 5 || groups.some((g) => (g.filters?.length ?? 0) > 6) || total > 18) {
        return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: 'Too many filters: at most 5 filterGroups, 6 filters per group and 18 filters in total' });
      }
      const after = Math.max(0, Number(body.after) || 0);
      if (after >= this.searchCap) {
        return json(400, { status: 'error', category: 'VALIDATION_ERROR', message: `Paging beyond ${this.searchCap} total results is not supported. Narrow the search with filters.` });
      }
      // Como HubSpot: el texto se parte en palabras y cada una tiene que estar en alguna de las propiedades de nombre.
      const words = q.split(/\s+/).filter(Boolean);
      const names = NAME_PROPS[type] ?? [];
      const hits = [...table.values()].sort(byId).filter((o) => {
        if (words.length && !words.every((w) => names.some((p) => (o.properties[p] ?? '').toLowerCase().includes(w)))) return false;
        if (groups.length && !groups.some((g) => (g.filters ?? []).every((f) => this.matches(o, f)))) return false;
        return true;
      });
      const sort = (Array.isArray(body.sorts) ? (body.sorts as Array<{ propertyName?: string; direction?: string } | string>) : [])[0];
      const sortName = typeof sort === 'string' ? sort : sort?.propertyName;
      if (sortName) {
        const dir = typeof sort === 'object' && sort?.direction === 'DESCENDING' ? -1 : 1;
        hits.sort((a, b) => {
          const [x, y] = [this.propValue(a, sortName), this.propValue(b, sortName)];
          const [nx, ny] = [numeric(x), numeric(y)];
          const d = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
          return dir * d || byId(a, b);
        });
      }
      const page = hits.slice(after, Math.min(after + limit, this.searchCap));
      return json(200, {
        total: hits.length,
        results: page.map((o) => this.pick(o, wanted)),
        ...(after + limit < hits.length ? { paging: { next: { after: String(after + limit) } } } : {}),
      });
    }

    if (!sub && method === 'POST') {
      const noWrite = writeDenied();
      if (noWrite) return noWrite;
      if (type === 'contacts') {
        const existing = this.emailOwner(String(((body.properties ?? {}) as FakeProps).email ?? ''));
        if (existing) return this.conflict(existing);
      }
      const o = this.create(type, body);
      this.stamp(type, o);
      return json(201, { id: o.id, properties: type === 'notes' ? (body.properties ?? {}) : o.properties });
    }

    if (!sub && method === 'GET') {
      const wantArchived = u.searchParams.get('archived') === 'true';
      const rows = [...(wantArchived ? this.archived[type] : table).values()].sort(byId);
      const after = u.searchParams.get('after');
      const from = after ? rows.findIndex((o) => Number(o.id) > Number(after)) : 0;
      const limit = limitOf(10, 100);
      const page = from < 0 ? [] : rows.slice(from, from + limit);
      const names = (u.searchParams.get('properties') ?? '').split(',').filter(Boolean);
      const more = from >= 0 && from + limit < rows.length;
      return json(200, { results: page.map((o) => this.pick(o, names)), ...(more ? { paging: { next: { after: page[page.length - 1].id } } } : {}) });
    }

    if (sub && !sub.includes('/')) {
      const idProperty = u.searchParams.get('idProperty') ?? '';
      const key = decodeURIComponent(sub);
      const lookup = () => {
        if (idProperty && idProperty !== 'hs_object_id') return [...table.values()].find((x) => (x.properties[idProperty] ?? '').toLowerCase() === key.toLowerCase());
        if (u.searchParams.get('archived') === 'true') return this.archived[type].get(key);
        return this.find(type, key);
      };
      if (method === 'GET') {
        const o = lookup();
        if (!o) return json(404, { category: 'OBJECT_NOT_FOUND' });
        return json(200, this.pick(o, (u.searchParams.get('properties') ?? '').split(',').filter(Boolean)));
      }
      if (method === 'PATCH') {
        const noWrite = writeDenied();
        if (noWrite) return noWrite;
        const o = idProperty ? lookup() : table.get(key);
        if (!o) return json(404, { category: 'OBJECT_NOT_FOUND' });
        const patch = (body.properties ?? {}) as FakeProps;
        const bad = this.problems(type, patch);
        if (bad.length) return this.invalid(bad);
        if (type === 'contacts' && patch.email) {
          const other = this.emailOwner(String(patch.email), o.id);
          if (other) return this.conflict(other);
        }
        for (const [name, value] of Object.entries(patch)) o.properties[name] = String(value ?? '');
        const at = this.touch(type, o);
        if (type === 'notes') return json(200, { id: o.id, properties: o.properties });
        return json(200, { id: o.id, properties: { ...patch, hs_lastmodifieddate: at }, updatedAt: at });
      }
      if (method === 'DELETE') {
        const noWrite = writeDenied();
        if (noWrite) return noWrite;
        this.archive(type, key);
        return json(204, null);
      }
    }
    return json(404, { message: 'not found' });
  }
}

// ======================================================================
// Cuentas con nombre (una por uso: 'lines', 'crm'…)
// ======================================================================

const holder = globalThis as unknown as { __hubspotFakePortals?: Map<string, FakeHubspotPortal> };
const portals = (): Map<string, FakeHubspotPortal> => (holder.__hubspotFakePortals ??= new Map());

/** La cuenta falsa con ese nombre; se crea con `seed` la primera vez. */
export function fakeHubspotPortal(name: string, seed: () => FakeHubspotPortal): FakeHubspotPortal {
  let p = portals().get(name);
  if (!p) portals().set(name, (p = seed()));
  return p;
}

/** Vuelve a crear la cuenta falsa con sus datos de arranque. */
export function resetFakeHubspotPortal(name: string, seed: () => FakeHubspotPortal): FakeHubspotPortal {
  const p = seed();
  portals().set(name, p);
  return p;
}

// ======================================================================
// Datos de arranque para probar un sync (contactos, empresas y negocios completos)
// ======================================================================

export const SYNC_PORTAL_ID = '515151';

/**
 * Una cuenta chica pero completa, para los tests de un sync: cada registro
 * tiene id, fecha de alta y de modificación, hay asociaciones con primaria,
 * dos dueños, dos pipelines y propiedades propias con opciones.
 */
export function seedSyncPortal(): FakeHubspotPortal {
  const p = new FakeHubspotPortal({ portalId: SYNC_PORTAL_ID });
  p.owners.set('81', { id: '81', email: 'ines@fake-portal.example', firstName: 'Ines', lastName: 'Vidal' });
  p.owners.set('82', { id: '82', email: 'teo@fake-portal.example', firstName: 'Teo', lastName: 'Rojas' });
  p.owners.set('83', { id: '83', email: 'gone@fake-portal.example', firstName: 'Former', lastName: 'Owner', archived: true });
  p.pipelines = [
    {
      id: 'default',
      label: 'Sales pipeline',
      stages: [
        { id: 'appointmentscheduled', label: 'Appointment scheduled', probability: '0.2' },
        { id: 'contractsent', label: 'Contract sent', probability: '0.8' },
        { id: 'closedwon', label: 'Closed won', probability: '1.0', closed: true },
        { id: 'closedlost', label: 'Closed lost', probability: '0.0', closed: true },
      ],
    },
    {
      id: 'renewals',
      label: 'Renewals',
      stages: [
        { id: 'renewal_open', label: 'Open', probability: '0.5' },
        { id: 'renewal_won', label: 'Renewed', probability: '1.0', closed: true },
      ],
    },
  ];
  const sys = (group: string): FakePropertyDef[] => [
    { name: 'createdate', label: 'Create date', type: 'datetime', fieldType: 'date', groupName: group, hubspotDefined: true, readOnlyValue: true },
    { name: 'hs_lastmodifieddate', label: 'Last modified date', type: 'datetime', fieldType: 'date', groupName: group, hubspotDefined: true, readOnlyValue: true },
    { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number', groupName: group, hubspotDefined: true, readOnlyValue: true },
    { name: 'hs_merged_object_ids', label: 'Merged record IDs', type: 'enumeration', fieldType: 'checkbox', groupName: group, hubspotDefined: true, readOnlyValue: true, hidden: true },
    { name: 'hubspot_owner_id', label: 'Owner', type: 'enumeration', fieldType: 'select', groupName: group, hubspotDefined: true, referencedObjectType: 'OWNER' },
  ];
  const text = (name: string, label: string, group: string): FakePropertyDef => ({ name, label, type: 'string', fieldType: 'text', groupName: group, hubspotDefined: true });
  p.propGroups = {
    contacts: [{ name: 'contactinformation', label: 'Contact information', displayOrder: 0 }],
    companies: [{ name: 'companyinformation', label: 'Company information', displayOrder: 0 }],
    deals: [{ name: 'dealinformation', label: 'Deal information', displayOrder: 0 }],
  };
  p.props.contacts = [
    ...['firstname:First name', 'lastname:Last name', 'email:Email', 'phone:Phone number', 'jobtitle:Job title'].map((x) => text(x.split(':')[0], x.split(':')[1], 'contactinformation')),
    { name: 'lifecyclestage', label: 'Lifecycle stage', type: 'enumeration', fieldType: 'radio', groupName: 'contactinformation', hubspotDefined: true, options: [{ label: 'Lead', value: 'lead' }, { label: 'Customer', value: 'customer' }] },
    { name: 'lastmodifieddate', label: 'Last modified date', type: 'datetime', fieldType: 'date', groupName: 'contactinformation', hubspotDefined: true, readOnlyValue: true },
    { name: 'associatedcompanyid', label: 'Primary company ID', type: 'number', fieldType: 'number', groupName: 'contactinformation', hubspotDefined: true, hidden: true },
    { name: 'preferred_language', label: 'Preferred language', type: 'enumeration', fieldType: 'select', groupName: 'contactinformation', options: [{ label: 'Spanish', value: 'es' }, { label: 'English', value: 'en' }, { label: 'Portuguese', value: 'pt' }] },
    ...sys('contactinformation'),
  ];
  p.props.companies = [
    ...['name:Company name', 'domain:Company domain name', 'city:City', 'country:Country/Region'].map((x) => text(x.split(':')[0], x.split(':')[1], 'companyinformation')),
    { name: 'numberofemployees', label: 'Number of employees', type: 'number', fieldType: 'number', groupName: 'companyinformation', hubspotDefined: true },
    { name: 'segment', label: 'Segment', type: 'enumeration', fieldType: 'select', groupName: 'companyinformation', options: [{ label: 'SMB', value: 'smb' }, { label: 'Mid-market', value: 'mid' }, { label: 'Enterprise', value: 'ent' }] },
    ...sys('companyinformation'),
  ];
  p.props.deals = [
    text('dealname', 'Deal name', 'dealinformation'),
    { name: 'dealstage', label: 'Deal stage', type: 'enumeration', fieldType: 'radio', groupName: 'dealinformation', hubspotDefined: true, options: p.pipelines.flatMap((x) => x.stages.map((s) => ({ label: s.label, value: s.id }))) },
    { name: 'pipeline', label: 'Pipeline', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', hubspotDefined: true, options: p.pipelines.map((x) => ({ label: x.label, value: x.id })) },
    { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number', groupName: 'dealinformation', hubspotDefined: true, showCurrencySymbol: true },
    { name: 'closedate', label: 'Close date', type: 'datetime', fieldType: 'date', groupName: 'dealinformation', hubspotDefined: true },
    { name: 'deal_currency_code', label: 'Currency', type: 'enumeration', fieldType: 'select', groupName: 'dealinformation', hubspotDefined: true, options: [{ label: 'US Dollar', value: 'USD' }, { label: 'Euro', value: 'EUR' }] },
    { name: 'renewal_type', label: 'Renewal type', type: 'enumeration', fieldType: 'checkbox', groupName: 'dealinformation', options: [{ label: 'Annual', value: 'annual' }, { label: 'Monthly', value: 'monthly' }] },
    ...sys('dealinformation'),
  ];
  const co1 = p.add('companies', { name: 'Northwind Parts', domain: 'northwind-parts.example', city: 'Mendoza', numberofemployees: '120', segment: 'mid', hubspot_owner_id: '81' }, '3001');
  const co2 = p.add('companies', { name: 'Tallgrass Labs', domain: 'tallgrass-labs.example', city: 'Tulsa', numberofemployees: '18', segment: 'smb', hubspot_owner_id: '82' }, '3002');
  // Dos empresas con el mismo dominio: HubSpot no las deduplica.
  p.add('companies', { name: 'Tallgrass Labs (EU)', domain: 'tallgrass-labs.example', city: 'Porto', segment: 'smb' }, '3003');
  const c1 = p.add('contacts', { firstname: 'Mara', lastname: 'Quiroga', email: 'mara@northwind-parts.example', phone: '+54 261 555 0111', lifecyclestage: 'customer', preferred_language: 'es', hubspot_owner_id: '81' }, '4001');
  const c2 = p.add('contacts', { firstname: 'Joel', lastname: 'Hart', email: 'joel@tallgrass-labs.example', lifecyclestage: 'lead', preferred_language: 'en', hubspot_owner_id: '82' }, '4002');
  // Un contacto sin email: HubSpot lo permite.
  const c3 = p.add('contacts', { firstname: 'Bia', lastname: 'Nunes', phone: '+351 22 555 0133', lifecyclestage: 'lead', preferred_language: 'pt' }, '4003');
  const d1 = p.add('deals', { dealname: 'Northwind annual plan', pipeline: 'default', dealstage: 'contractsent', amount: '18000', deal_currency_code: 'USD', closedate: '2027-01-31T00:00:00.000Z', hubspot_owner_id: '81', renewal_type: 'annual' }, '6001');
  const d2 = p.add('deals', { dealname: 'Tallgrass pilot', pipeline: 'default', dealstage: 'appointmentscheduled', amount: '2400', deal_currency_code: 'USD', hubspot_owner_id: '82' }, '6002');
  p.associate('contacts', c1, 'companies', co1, { primary: true });
  p.associate('contacts', c2, 'companies', co2, { primary: true });
  p.associate('contacts', c3, 'companies', co2);
  p.associate('deals', d1, 'contacts', c1);
  p.associate('deals', d1, 'companies', co1, { primary: true });
  p.associate('deals', d2, 'contacts', c2);
  p.associate('deals', d2, 'companies', co2, { primary: true });
  return p;
}
