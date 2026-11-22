/**
 * CRM — lo que sale por eventos (webhooks de la API, Zapier/Make, flows) con
 * el acceso de la persona que creó cada suscripción. Server-only.
 *
 * Modelo: una suscripción actúa como quien la creó, igual que una API key
 * (lib/api-auth.ts). Owner y admins reciben todo lo que ven en la app; una
 * persona con restricciones (un admin que pasó a miembro, el creador de un
 * flow) recibe solo los registros de su alcance y sin los campos propios que
 * tiene ocultos; quien ya no es parte del workspace no recibe nada. Un webhook
 * viejo sin creador cuenta como un miembro sin registros propios.
 *
 * Se aplica al emitir (personalize de lib/webhooks.ts y lib/flow.ts) y otra
 * vez en cada reintento o reenvío, con el acceso de ese momento.
 */
import { getDb, type Db } from './db';
import { hiddenFieldsFor, isUnrestricted, redactCustomJson, type FieldViewer } from './crm-field-perms';
import { canSeeEntity, canSeeOwner, ownerScopeFor, type OwnerScope } from './crm-visibility';
import { maskPrivateRef, PRIVATE_REFS } from './crm-record-scope';
import { normalizeRole } from './teams';

export type CrmEventEntity = 'contact' | 'company' | 'deal';

const FIELD_ENTITY: Record<CrmEventEntity, 'contacts' | 'companies' | 'deals'> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
};

export type EventData = Record<string, unknown>;
export type Personalizer = (creatorId: string | null) => Promise<{ data: EventData } | null>;

interface Subscriber {
  viewer: FieldViewer;
  scope: OwnerScope;
  unrestricted: boolean;
}

/** Rol de la persona en el workspace; null si ya no es parte (o es invitada). */
async function personRole(workspaceId: string, personId: string, db: Db): Promise<FieldViewer['role'] | null> {
  if (personId === workspaceId) return 'owner';
  const row = (await db
    .prepare(
      `SELECT m.role FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'guest'
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1`,
    )
    .get(workspaceId, personId)) as { role: string } | undefined;
  return row ? normalizeRole(row.role) : null;
}

/**
 * Con el acceso de quién se arma el evento para una suscripción. null si su
 * creador ya no es parte del workspace (no se le manda nada).
 */
export async function subscriberFor(workspaceId: string, creatorId: string | null, db: Db = getDb()): Promise<Subscriber | null> {
  let viewer: FieldViewer;
  if (creatorId === null) {
    viewer = { workspaceId, personId: '', role: 'member' };
  } else {
    const role = await personRole(workspaceId, creatorId, db);
    if (!role) return null;
    viewer = { workspaceId, personId: creatorId, role };
  }
  const unrestricted = isUnrestricted(viewer);
  return { viewer, unrestricted, scope: unrestricted ? null : await ownerScopeFor(viewer, db) };
}

function isObj(v: unknown): v is EventData {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Saca de un objeto `custom` (ya parseado o en JSON) los campos ocultos. Puro. */
export function withoutHidden(custom: unknown, hidden: ReadonlySet<string>): unknown {
  if (!hidden.size) return custom;
  if (typeof custom === 'string') return redactCustomJson(custom, hidden);
  if (!isObj(custom)) return custom;
  const out: EventData = {};
  for (const [k, v] of Object.entries(custom)) if (!hidden.has(k)) out[k] = v;
  return out;
}

/** Lista de propiedades cambiadas sin las `custom.<x>` ocultas. Puro. */
export function changedWithoutHidden(changed: unknown, hidden: ReadonlySet<string>): unknown {
  if (!Array.isArray(changed) || !hidden.size) return changed;
  return changed.filter((f) => !(typeof f === 'string' && f.startsWith('custom.') && hidden.has(f.slice(7))));
}

/**
 * Un registro (contact.*, company.*, deal.*) como lo ve la suscripción: null
 * si no ve el registro; si no, sin campos ocultos en `custom` ni en
 * `change.changed`, y sin el id de una empresa asociada que no ve.
 */
export async function recordEventFor(
  sub: Subscriber,
  entity: CrmEventEntity,
  data: EventData,
  opts: { ownerId?: string | null } = {},
  db: Db = getDb(),
): Promise<EventData | null> {
  if (sub.unrestricted) return data;
  const ws = sub.viewer.workspaceId;
  const id = typeof data.id === 'string' ? data.id : '';
  // Registro ya borrado (*.deleted): se mira el owner que tenía.
  if (opts.ownerId !== undefined) {
    if (!canSeeOwner(sub.scope, opts.ownerId, ws)) return null;
  } else if (!id || !(await canSeeEntity(ws, entity, id, sub.scope))) {
    return null;
  }
  const hidden = await hiddenFieldsFor(sub.viewer, FIELD_ENTITY[entity], db);
  let out: EventData = { ...data };
  if ('custom' in out) out.custom = withoutHidden(out.custom, hidden);
  if (isObj(out.change) && 'changed' in out.change) out.change = { ...out.change, changed: changedWithoutHidden(out.change.changed, hidden) };
  out = ((await maskPrivateRef(ws, out, [PRIVATE_REFS.company([]), PRIVATE_REFS.parent()], sub.scope, db)) ?? out) as EventData;
  return out;
}

/**
 * `<entity>.property_changed`: null si no ve el registro o la propiedad es un
 * campo que tiene oculto; el id de una empresa que no ve sale vacío.
 */
export async function propertyChangeFor(sub: Subscriber, data: EventData, db: Db = getDb()): Promise<EventData | null> {
  if (sub.unrestricted) return data;
  const ws = sub.viewer.workspaceId;
  const entity = data.objectType;
  const id = typeof data.id === 'string' ? data.id : '';
  if ((entity !== 'contact' && entity !== 'company' && entity !== 'deal') || !id) return null;
  if (!(await canSeeEntity(ws, entity, id, sub.scope))) return null;
  const property = typeof data.property === 'string' ? data.property : '';
  if (property.startsWith('custom.')) {
    const hidden = await hiddenFieldsFor(sub.viewer, FIELD_ENTITY[entity], db);
    if (hidden.has(property.slice(7))) return null;
  }
  if (property === 'company_id' || property === 'parent_company_id') {
    const out = { ...data };
    for (const k of ['oldValue', 'newValue'] as const) {
      const v = out[k];
      if (typeof v === 'string' && v && !(await canSeeEntity(ws, 'company', v, sub.scope))) out[k] = null;
    }
    return out;
  }
  return data;
}

/**
 * form.submitted: sin los valores que van a un campo propio que la
 * suscripción tiene oculto. Si el contacto (o el deal) es de otro alcance, no
 * se le manda el envío (como en la tabla de envíos).
 */
export async function formSubmittedFor(
  sub: Subscriber,
  data: EventData,
  fields: Array<{ id: string; property: string }> | null,
  db: Db = getDb(),
): Promise<EventData | null> {
  if (sub.unrestricted) return data;
  const ws = sub.viewer.workspaceId;
  const contact = isObj(data.contact) ? data.contact : null;
  if (contact && typeof contact.id === 'string' && !(await canSeeEntity(ws, 'contact', contact.id, sub.scope))) return null;
  const deal = isObj(data.deal) ? data.deal : null;
  const out: EventData = { ...data };
  if (deal && typeof deal.id === 'string' && !(await canSeeEntity(ws, 'deal', deal.id, sub.scope))) delete out.deal;
  const submission = isObj(data.submission) ? data.submission : null;
  if (submission && isObj(submission.values)) {
    const { formFieldIdsFor } = await import('./crm-forms');
    const [contacts, companies] = await Promise.all([
      hiddenFieldsFor(sub.viewer, 'contacts', db),
      hiddenFieldsFor(sub.viewer, 'companies', db),
    ]);
    // Sin la definición del form (borrado) no se sabe a dónde iba cada valor: no sale ninguno.
    const drop = fields ? formFieldIdsFor(fields, { contacts, companies }) : null;
    const values: EventData = {};
    if (drop) for (const [k, v] of Object.entries(submission.values)) if (!drop.has(k)) values[k] = v;
    out.submission = { ...submission, values };
  }
  return out;
}

/** contact.score_changed: solo si ve el contacto, y sin el detalle por regla (puede citar un campo oculto). */
export async function scoreChangedFor(sub: Subscriber, data: EventData): Promise<EventData | null> {
  if (sub.unrestricted) return data;
  const id = typeof data.id === 'string' ? data.id : '';
  if (!id || !(await canSeeEntity(sub.viewer.workspaceId, 'contact', id, sub.scope))) return null;
  const { breakdown: _b, ...rest } = data;
  return rest;
}

const RECORD_EVENT = /^(contact|company|deal)\.(created|updated|stage_changed|won|lost|deleted)$/;

/** ¿Es un evento del CRM cuyo cuerpo depende de quién lo recibe? */
export function isPersonalCrmEvent(event: string): boolean {
  return (
    RECORD_EVENT.test(event) ||
    /^(contact|company|deal)\.property_changed$/.test(event) ||
    event === 'form.submitted' ||
    event === 'contact.score_changed'
  );
}

async function formFields(workspaceId: string, formId: unknown): Promise<Array<{ id: string; property: string }> | null> {
  if (typeof formId !== 'string' || !formId) return null;
  const { getForm } = await import('./crm-forms');
  const form = await getForm(workspaceId, formId);
  return form ? form.fields : null;
}

/**
 * Cualquier evento personal del CRM como lo ve la suscripción (para el
 * reintento o reenvío de una entrega guardada). null = no se le manda.
 * Otros eventos pasan tal cual.
 */
export async function crmEventFor(
  sub: Subscriber,
  event: string,
  data: EventData,
  ctx: { ownerId?: string | null; formFields?: Array<{ id: string; property: string }> | null } = {},
): Promise<EventData | null> {
  if (sub.unrestricted || !isPersonalCrmEvent(event)) return data;
  if (event === 'form.submitted') {
    const fields = ctx.formFields !== undefined ? ctx.formFields : await formFields(sub.viewer.workspaceId, isObj(data.form) ? data.form.id : null);
    return formSubmittedFor(sub, data, fields);
  }
  if (event === 'contact.score_changed') return scoreChangedFor(sub, data);
  if (event.endsWith('.property_changed')) return propertyChangeFor(sub, data);
  const entity = event.split('.')[0] as CrmEventEntity;
  // Un borrado ya no tiene fila: sin el owner que tenía, quien tiene alcance no lo recibe.
  if (event.endsWith('.deleted') && ctx.ownerId === undefined) return sub.scope ? null : recordEventFor(sub, entity, data, { ownerId: null });
  return recordEventFor(sub, entity, data, ctx.ownerId !== undefined ? { ownerId: ctx.ownerId } : {});
}

/** personalize de lib/events.ts / lib/webhooks.ts para un evento del CRM (cachea por creador). */
export function crmPersonalizer(
  workspaceId: string,
  event: string,
  data: EventData,
  ctx: { ownerId?: string | null; formFields?: Array<{ id: string; property: string }> | null } = {},
): Personalizer {
  const cache = new Map<string, Promise<{ data: EventData } | null>>();
  return (creatorId) => {
    const key = creatorId ?? '';
    let hit = cache.get(key);
    if (!hit) {
      hit = (async () => {
        const sub = await subscriberFor(workspaceId, creatorId);
        if (!sub) return null;
        const own = await crmEventFor(sub, event, data, ctx);
        return own ? { data: own } : null;
      })();
      cache.set(key, hit);
    }
    return hit;
  };
}

/**
 * Cuerpo de una entrega guardada como lo puede recibir hoy el creador del
 * webhook. null = ya no le corresponde (no se manda). Si no cambió devuelve
 * el mismo string.
 */
export async function deliveryPayloadFor(workspaceId: string, creatorId: string | null, event: string, payload: string): Promise<string | null> {
  if (!isPersonalCrmEvent(event)) return payload;
  let body: EventData;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!isObj(parsed)) return null;
    body = parsed;
  } catch {
    return null;
  }
  const sub = await subscriberFor(workspaceId, creatorId);
  if (!sub) return null;
  if (sub.unrestricted) return payload;
  const data = isObj(body.data) ? body.data : {};
  const own = await crmEventFor(sub, event, data);
  if (!own) return null;
  const next = JSON.stringify({ ...body, data: own });
  return next === JSON.stringify(body) ? payload : next;
}
