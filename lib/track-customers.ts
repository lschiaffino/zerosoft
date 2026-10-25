/**
 * Track — pedidos de clientes (customer requests de Linear): un pedido une un
 * cliente del CRM (empresa y/o contacto, o solo nombre y email) con un issue,
 * con la cita textual, de dónde vino (CRM, Chat, Groups, email, formulario,
 * API) y la marca de importante. El issue muestra sus clientes; la empresa y
 * el contacto del CRM, sus pedidos; las listas ordenan por cantidad de
 * clientes o por ingresos (deals ganados de la empresa en el CRM).
 *
 * workspace_id = dueño del workspace (donde viven los datos del CRM).
 * Server-only.
 */
import { getDb } from './db';
import { scopeAnd, type OwnerScope } from './crm-visibility';
import { likeContains } from './track-views';
import { emailDomain, REQUEST_SOURCES, type RequestSource } from './track-triage-shared';

function nowIso(): string {
  return new Date().toISOString();
}

export class CustomerRequestError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

interface RequestRow {
  id: string;
  workspace_id: string;
  issue_id: string;
  company_id: string | null;
  contact_id: string | null;
  customer_name: string;
  customer_email: string;
  important: number;
  body: string;
  source: RequestSource;
  source_url: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company_name?: string | null;
  company_domain?: string | null;
  contact_first?: string | null;
  contact_last?: string | null;
  contact_email?: string | null;
  author_name?: string | null;
  identifier?: string;
  issue_title?: string;
  status_name?: string | null;
  status_category?: string | null;
  priority?: string;
}

export interface CustomerRequestDto {
  id: string;
  issueId: string;
  companyId: string | null;
  contactId: string | null;
  /** Nombre a mostrar: empresa, si no contacto, si no el nombre libre. */
  customer: string;
  contactName: string | null;
  email: string;
  domain: string | null;
  important: boolean;
  body: string;
  source: RequestSource;
  sourceUrl: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  issue?: { identifier: string; title: string; statusName: string | null; statusCategory: string | null; priority: string };
}

const SELECT = `
  SELECT r.*, c.name AS company_name, c.domain AS company_domain,
    ct.first_name AS contact_first, ct.last_name AS contact_last, ct.email AS contact_email,
    u.name AS author_name,
    i.identifier, i.title AS issue_title, i.priority, s.name AS status_name, s.category AS status_category
  FROM track_customer_requests r
  JOIN track_issues i ON i.id = r.issue_id
  LEFT JOIN track_statuses s ON s.id = i.status_id
  LEFT JOIN crm_companies c ON c.id = r.company_id
  LEFT JOIN crm_contacts ct ON ct.id = r.contact_id
  LEFT JOIN users u ON u.id = r.created_by`;

function toDto(r: RequestRow): CustomerRequestDto {
  const contactName = [r.contact_first, r.contact_last].filter(Boolean).join(' ').trim() || null;
  const email = r.contact_email || r.customer_email || '';
  return {
    id: r.id,
    issueId: r.issue_id,
    companyId: r.company_id,
    contactId: r.contact_id,
    customer: r.company_name || contactName || r.customer_name || email,
    contactName,
    email,
    domain: r.company_domain || (email ? emailDomain(email) : null),
    important: Boolean(r.important),
    body: r.body,
    source: r.source,
    sourceUrl: r.source_url,
    authorName: r.author_name ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    issue: r.identifier
      ? {
          identifier: r.identifier,
          title: r.issue_title ?? '',
          statusName: r.status_name ?? null,
          statusCategory: r.status_category ?? null,
          priority: r.priority ?? 'medium',
        }
      : undefined,
  };
}

export async function listIssueRequests(issueId: string): Promise<CustomerRequestDto[]> {
  const rows = (await getDb().prepare(`${SELECT} WHERE r.issue_id = ? ORDER BY r.important DESC, r.created_at ASC`).all(issueId)) as RequestRow[];
  return rows.map(toDto);
}

export async function getRequest(id: string): Promise<(CustomerRequestDto & { workspaceId: string }) | null> {
  const row = (await getDb().prepare(`${SELECT} WHERE r.id = ?`).get(id)) as RequestRow | undefined;
  return row ? { ...toDto(row), workspaceId: row.workspace_id } : null;
}

/**
 * Pedidos de una empresa o de un contacto del CRM. `accessibleProject`
 * filtra los issues de proyectos que la persona no ve.
 */
export async function listCustomerRequests(
  workspaceId: string,
  by: { companyId?: string; contactId?: string; domain?: string; name?: string },
  accessibleProject: (projectId: string) => Promise<boolean>,
): Promise<CustomerRequestDto[]> {
  const where: string[] = ['r.workspace_id = ?'];
  const args: string[] = [workspaceId];
  if (by.companyId) {
    // Los pedidos de los contactos de la empresa también cuentan para la empresa.
    where.push(
      '(r.company_id = ? OR r.contact_id IN (SELECT id FROM crm_contacts WHERE user_id = ? AND company_id = ?) OR r.contact_id IN (SELECT contact_id FROM crm_contact_companies WHERE company_id = ?))',
    );
    args.push(by.companyId, workspaceId, by.companyId, by.companyId);
  } else if (by.contactId) {
    where.push('r.contact_id = ?');
    args.push(by.contactId);
  } else if (by.domain) {
    where.push("(LOWER(c.domain) = ? OR LOWER(r.customer_email) LIKE ? ESCAPE '\\')");
    args.push(by.domain.toLowerCase(), `%@${by.domain.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}`);
  } else if (by.name) {
    where.push('r.company_id IS NULL AND r.contact_id IS NULL AND LOWER(r.customer_name) = ?');
    args.push(by.name.toLowerCase());
  } else {
    return [];
  }
  const rows = (await getDb()
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 500`)
    .all(...args)) as Array<RequestRow & { project_id?: string }>;
  const projectOf = (await getDb()
    .prepare(
      `SELECT id, project_id FROM track_issues WHERE id IN (${rows.map(() => '?').join(', ') || "''"})`,
    )
    .all(...rows.map((r) => r.issue_id))) as Array<{ id: string; project_id: string }>;
  const pmap = new Map(projectOf.map((p) => [p.id, p.project_id]));
  const okProjects = new Map<string, boolean>();
  const out: CustomerRequestDto[] = [];
  for (const r of rows) {
    const pid = pmap.get(r.issue_id);
    if (!pid) continue;
    if (!okProjects.has(pid)) okProjects.set(pid, await accessibleProject(pid));
    if (okProjects.get(pid)) out.push(toDto(r));
  }
  return out;
}

export interface CustomerRequestInput {
  companyId?: string | null;
  contactId?: string | null;
  customerName?: string;
  customerEmail?: string;
  important?: boolean;
  body?: string;
  source?: RequestSource;
  sourceUrl?: string;
}

async function checkCrmRefs(workspaceId: string, input: CustomerRequestInput, scope: OwnerScope): Promise<void> {
  const db = getDb();
  if (input.companyId) {
    const s = scopeAnd('c', scope);
    const ok = await db.prepare(`SELECT id FROM crm_companies c WHERE id = ? AND user_id = ?${s.sql}`).get(input.companyId, workspaceId, ...s.args);
    if (!ok) throw new CustomerRequestError('invalid_company');
  }
  if (input.contactId) {
    const s = scopeAnd('c', scope);
    const ok = await db.prepare(`SELECT id FROM crm_contacts c WHERE id = ? AND user_id = ?${s.sql}`).get(input.contactId, workspaceId, ...s.args);
    if (!ok) throw new CustomerRequestError('invalid_contact');
  }
}

/**
 * Empresa del CRM para un email: por el dominio (sin gmail y similares) o por
 * la empresa del contacto con ese email. null si no hay.
 */
export async function matchCrmCustomer(
  workspaceId: string,
  email: string,
): Promise<{ companyId: string | null; contactId: string | null }> {
  const db = getDb();
  const clean = email.trim().toLowerCase();
  if (!clean) return { companyId: null, contactId: null };
  const contact = (await db
    .prepare('SELECT id, company_id FROM crm_contacts WHERE user_id = ? AND LOWER(email) = ? ORDER BY created_at ASC LIMIT 1')
    .get(workspaceId, clean)) as { id: string; company_id: string | null } | undefined;
  let companyId = contact?.company_id ?? null;
  const domain = emailDomain(clean);
  if (!companyId && domain) {
    const company = (await db
      .prepare("SELECT id FROM crm_companies WHERE user_id = ? AND (LOWER(domain) = ? OR LOWER(domain) = ?) ORDER BY created_at ASC LIMIT 1")
      .get(workspaceId, domain, `www.${domain}`)) as { id: string } | undefined;
    companyId = company?.id ?? null;
  }
  return { companyId, contactId: contact?.id ?? null };
}

export async function createCustomerRequest(
  workspaceId: string,
  issueId: string,
  input: CustomerRequestInput,
  userId: string | null,
  scope: OwnerScope = null,
): Promise<CustomerRequestDto> {
  await checkCrmRefs(workspaceId, input, scope);
  const name = (input.customerName ?? '').trim().slice(0, 200);
  const email = (input.customerEmail ?? '').trim().toLowerCase().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CustomerRequestError('invalid_email');
  if (!input.companyId && !input.contactId && !name && !email) throw new CustomerRequestError('missing_customer');
  const source = input.source && (REQUEST_SOURCES as readonly string[]).includes(input.source) ? input.source : 'manual';
  const sourceUrl = (input.sourceUrl ?? '').trim().slice(0, 1000);
  if (sourceUrl && !/^(https?:\/\/|\/)/i.test(sourceUrl)) throw new CustomerRequestError('invalid_url');
  let { companyId, contactId } = { companyId: input.companyId ?? null, contactId: input.contactId ?? null };
  // Solo email: se busca la empresa del CRM por el dominio, como Linear.
  if (!companyId && !contactId && email) ({ companyId, contactId } = await matchCrmCustomer(workspaceId, email));
  if (contactId && !companyId) {
    const c = (await getDb().prepare('SELECT company_id FROM crm_contacts WHERE id = ?').get(contactId)) as { company_id: string | null } | undefined;
    companyId = c?.company_id ?? null;
  }
  const id = crypto.randomUUID();
  const ts = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO track_customer_requests (id, workspace_id, issue_id, company_id, contact_id, customer_name, customer_email, important, body, source, source_url, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, issueId, companyId, contactId, name, email, input.important ? 1 : 0, (input.body ?? '').trim().slice(0, 5000), source, sourceUrl, userId, ts, ts);
  return (await getRequest(id)) as CustomerRequestDto;
}

export async function updateCustomerRequest(
  id: string,
  workspaceId: string,
  input: CustomerRequestInput,
  scope: OwnerScope = null,
): Promise<CustomerRequestDto | null> {
  await checkCrmRefs(workspaceId, input, scope);
  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  if (input.important !== undefined) {
    fields.push('important = ?');
    args.push(input.important ? 1 : 0);
  }
  if (input.body !== undefined) {
    fields.push('body = ?');
    args.push(input.body.trim().slice(0, 5000));
  }
  if (input.companyId !== undefined) {
    fields.push('company_id = ?');
    args.push(input.companyId);
  }
  if (input.contactId !== undefined) {
    fields.push('contact_id = ?');
    args.push(input.contactId);
  }
  if (input.customerName !== undefined) {
    fields.push('customer_name = ?');
    args.push(input.customerName.trim().slice(0, 200));
  }
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso(), id, workspaceId);
    await getDb().prepare(`UPDATE track_customer_requests SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...args);
  }
  return getRequest(id);
}

export async function deleteCustomerRequest(id: string, workspaceId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_customer_requests WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  return res.changes > 0;
}

/** Al marcar un issue como duplicado, sus pedidos pasan al original (como Linear). */
export async function moveRequests(fromIssueId: string, toIssueId: string): Promise<number> {
  const res = await getDb()
    .prepare("UPDATE track_customer_requests SET issue_id = ?, updated_at = ? WHERE issue_id = ?")
    .run(toIssueId, nowIso(), fromIssueId);
  return res.changes;
}

// ---------- Búsqueda de clientes del CRM ----------

export interface CustomerOption {
  kind: 'company' | 'contact';
  id: string;
  name: string;
  meta: string;
  companyId: string | null;
}

export async function searchCrmCustomers(workspaceId: string, q: string, scope: OwnerScope): Promise<CustomerOption[]> {
  const db = getDb();
  const needle = q.trim();
  const like = likeContains(needle);
  const sc = scopeAnd('c', scope);
  const companies = (await db
    .prepare(
      `SELECT c.id, c.name, c.domain FROM crm_companies c WHERE c.user_id = ?${sc.sql}
       AND (c.name LIKE ? ESCAPE '\\' OR c.domain LIKE ? ESCAPE '\\') ORDER BY c.name COLLATE NOCASE LIMIT 6`,
    )
    .all(workspaceId, ...sc.args, like, like)) as Array<{ id: string; name: string; domain: string }>;
  const contacts = (await db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.company_id, co.name AS company_name FROM crm_contacts c
       LEFT JOIN crm_companies co ON co.id = c.company_id
       WHERE c.user_id = ?${sc.sql}
       AND (c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR (c.first_name || ' ' || c.last_name) LIKE ? ESCAPE '\\')
       ORDER BY c.first_name COLLATE NOCASE LIMIT 6`,
    )
    .all(workspaceId, ...sc.args, like, like, like, like)) as Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    company_id: string | null;
    company_name: string | null;
  }>;
  return [
    ...companies.map((c) => ({ kind: 'company' as const, id: c.id, name: c.name || c.domain, meta: c.domain, companyId: c.id })),
    ...contacts.map((c) => ({
      kind: 'contact' as const,
      id: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
      meta: [c.email, c.company_name].filter(Boolean).join(' · '),
      companyId: c.company_id,
    })),
  ];
}

// ---------- Clientes (agregado) ----------

export interface CustomerSummary {
  key: string;
  kind: 'company' | 'contact' | 'other';
  id: string | null;
  name: string;
  domain: string | null;
  requests: number;
  important: number;
  openIssues: number;
  /** Suma de deals ganados de la empresa en el CRM (null si no es una empresa del CRM). */
  revenue: number | null;
  currency: string | null;
  lastRequestAt: string;
}

/** Ingresos por empresa: deals ganados asociados (crm_deal_companies) en etapas ganadas. */
export async function companyRevenue(workspaceId: string, companyIds: string[]): Promise<Map<string, { amount: number; currency: string }>> {
  const out = new Map<string, { amount: number; currency: string }>();
  if (companyIds.length === 0) return out;
  const ids = [...new Set(companyIds)].slice(0, 500);
  const rows = (await getDb()
    .prepare(
      `SELECT dc.company_id, SUM(d.amount) AS amount, MAX(d.currency) AS currency
       FROM crm_deal_companies dc JOIN crm_deals d ON d.id = dc.deal_id
       JOIN crm_stages st ON st.id = d.stage_id
       WHERE d.user_id = ? AND st.is_won = 1 AND dc.company_id IN (${ids.map(() => '?').join(', ')})
       GROUP BY dc.company_id`,
    )
    .all(workspaceId, ...ids)
    .catch(() => [] as Array<{ company_id: string; amount: number; currency: string }>)) as Array<{
    company_id: string;
    amount: number;
    currency: string;
  }>;
  for (const r of rows) out.set(r.company_id, { amount: Number(r.amount) || 0, currency: r.currency || 'USD' });
  return out;
}

/**
 * Clientes con pedidos en los proyectos que la persona ve: agrupa por empresa
 * del CRM, si no por contacto, si no por dominio o nombre libre.
 */
export async function listCustomers(workspaceId: string, projectIds: string[]): Promise<CustomerSummary[]> {
  if (projectIds.length === 0) return [];
  const rows = (await getDb()
    .prepare(
      `${SELECT} WHERE r.workspace_id = ? AND i.project_id IN (${projectIds.map(() => '?').join(', ')})
       ORDER BY r.created_at DESC LIMIT 5000`,
    )
    .all(workspaceId, ...projectIds)) as RequestRow[];
  const map = new Map<string, CustomerSummary & { issueIds: Set<string>; openIds: Set<string> }>();
  for (const r of rows) {
    const d = toDto(r);
    const key = r.company_id ? `company:${r.company_id}` : r.contact_id ? `contact:${r.contact_id}` : d.domain ? `domain:${d.domain}` : `name:${d.customer.toLowerCase()}`;
    let c = map.get(key);
    if (!c) {
      c = {
        key,
        kind: r.company_id ? 'company' : r.contact_id ? 'contact' : 'other',
        id: r.company_id ?? r.contact_id ?? null,
        // Sin ficha en el CRM, el cliente es la empresa del dominio del email (como Linear).
        name: !r.company_id && !r.contact_id && d.domain ? d.domain : d.customer,
        domain: d.domain,
        requests: 0,
        important: 0,
        openIssues: 0,
        revenue: null,
        currency: null,
        lastRequestAt: r.created_at,
        issueIds: new Set(),
        openIds: new Set(),
      };
      map.set(key, c);
    }
    c.requests++;
    if (r.important) c.important++;
    c.issueIds.add(r.issue_id);
    if (r.status_category !== 'done' && r.status_category !== 'cancelled') c.openIds.add(r.issue_id);
  }
  const companies = [...map.values()].filter((c) => c.kind === 'company' && c.id).map((c) => c.id as string);
  const revenue = await companyRevenue(workspaceId, companies);
  return [...map.values()]
    .map(({ issueIds: _i, openIds, ...c }) => {
      const rev = c.kind === 'company' && c.id ? revenue.get(c.id) : undefined;
      return { ...c, openIssues: openIds.size, revenue: rev ? rev.amount : c.kind === 'company' ? 0 : null, currency: rev?.currency ?? null };
    })
    .sort((a, b) => b.requests - a.requests || (b.revenue ?? 0) - (a.revenue ?? 0) || a.name.localeCompare(b.name));
}

/** Para las listas: clientes distintos e ingresos por issue. */
export async function issueDemand(issueIds: string[]): Promise<Map<string, { customers: number; important: number; revenue: number }>> {
  const out = new Map<string, { customers: number; important: number; revenue: number }>();
  if (issueIds.length === 0) return out;
  const db = getDb();
  for (let i = 0; i < issueIds.length; i += 200) {
    const chunk = issueIds.slice(i, i + 200);
    const rows = (await db
      .prepare(
        `SELECT issue_id, COUNT(DISTINCT COALESCE(company_id, contact_id, customer_email, customer_name)) AS customers, SUM(important) AS important
         FROM track_customer_requests WHERE issue_id IN (${chunk.map(() => '?').join(', ')}) GROUP BY issue_id`,
      )
      .all(...chunk)) as Array<{ issue_id: string; customers: number; important: number }>;
    for (const r of rows) out.set(r.issue_id, { customers: Number(r.customers), important: Number(r.important) || 0, revenue: 0 });
  }
  return out;
}
