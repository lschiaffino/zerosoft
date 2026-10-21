/**
 * CRM — empresas duplicadas y merge. Server-only (las funciones de
 * normalización y agrupado son puras y se testean solas).
 *
 * Duplicados: empresas del workspace que comparten dominio (sin protocolo,
 * www ni path) o nombre normalizado (minúsculas, sin acentos, puntuación ni
 * sufijos societarios como "Inc", "S.A." o "Ltda"). Los grupos que se
 * solapan se unen: si A comparte dominio con B y B nombre con C, es un grupo.
 *
 * Merge (estilo HubSpot): la que queda gana; sus campos vacíos se completan
 * con los de la descartada. Contactos, deals, actividades, tags, archivos,
 * empresas hijas e historial pasan a la que queda. Antes de borrarla, la
 * descartada entra a la papelera con su estado completo (marcada como
 * fusionada), así un merge equivocado se puede deshacer restaurándola.
 */
import { ensureMigrated, getClient, getDb, txDb, type CrmCompanyRow, type Db } from './db';
import { syncContactPrimary, syncDealPrimary } from './crm-assoc';
import { trashRecords } from './crm-trash';
import { parseCustom } from './crm';
import { normalizeCompanyDomain } from './crm-domain';

export { normalizeCompanyDomain };

// ---------- Normalización (puro) ----------

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'ag',
  'sa', 'sas', 'srl', 'sl', 'sac', 'sau', 'spa', 'sapi', 'cv', 'de', 'ltda', 'eireli', 'me', 'bv', 'nv', 'oy', 'ab', 'pty',
]);

/** "Acme, Inc." → "acme"; "Café Martínez S.A." → "cafe martinez". */
export function normalizeCompanyName(raw: string | null | undefined): string {
  const words = (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // "S.A." / "S.R.L." → "sa" / "srl" antes de partir en palabras.
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, '$1')
    .replace(/\b([a-z])\.(?=\s|$)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  // Saca sufijos societarios del final ("acme sa de cv" → "acme").
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

export interface DupCandidate {
  id: string;
  name: string;
  domain: string;
  created_at: string;
}

export interface CompanyDuplicateGroup<T extends DupCandidate = DupCandidate> {
  /** Por qué se agruparon: dominio, nombre o ambos. */
  reasons: Array<'domain' | 'name'>;
  /** Dominio o nombre normalizado en común (el primero que unió al grupo). */
  key: string;
  /** Más antigua primero (la sugerida para quedar). */
  companies: T[];
}

/** Agrupa candidatas por dominio o nombre normalizado (unión de grupos solapados). */
export function groupCompanyDuplicates<T extends DupCandidate>(rows: T[]): CompanyDuplicateGroup<T>[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const r of rows) parent.set(r.id, r.id);
  const reasons = new Map<string, Set<'domain' | 'name'>>();
  const keys = new Map<string, string>();
  const byKey = (kind: 'domain' | 'name', keyOf: (r: T) => string) => {
    const first = new Map<string, string>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!k) continue;
      const seen = first.get(k);
      if (!seen) {
        first.set(k, r.id);
        continue;
      }
      union(seen, r.id);
      const tag = `${kind}:${k}`;
      reasons.set(seen, (reasons.get(seen) ?? new Set()).add(kind));
      reasons.set(r.id, (reasons.get(r.id) ?? new Set()).add(kind));
      if (!keys.has(seen)) keys.set(seen, tag);
    }
  };
  byKey('domain', (r) => normalizeCompanyDomain(r.domain));
  // Nombres de una sola letra o vacíos no alcanzan para decir que es la misma.
  byKey('name', (r) => {
    const n = normalizeCompanyName(r.name);
    return n.length >= 2 ? n : '';
  });
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const root = find(r.id);
    groups.set(root, [...(groups.get(root) ?? []), r]);
  }
  const out: CompanyDuplicateGroup<T>[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const rs = new Set<'domain' | 'name'>();
    let key = '';
    for (const m of members) {
      for (const x of reasons.get(m.id) ?? []) rs.add(x);
      if (!key && keys.has(m.id)) key = keys.get(m.id)!.replace(/^(domain|name):/, '');
    }
    out.push({ reasons: (['domain', 'name'] as const).filter((x) => rs.has(x)), key, companies: members });
  }
  return out.sort((a, b) => b.companies.length - a.companies.length || a.key.localeCompare(b.key));
}

/** Columnas de texto que el merge completa si están vacías en la que queda. */
const FILL_COLUMNS = ['domain', 'industry', 'phone', 'website', 'city', 'country'] as const;

/**
 * Pares [columna, valor] para completar en `keep` lo vacío con lo de `drop`:
 * texto, empleados, owner, empresa madre (si no es la que queda) y custom fields.
 */
export function companyMergeFillPatch(keep: CrmCompanyRow, drop: CrmCompanyRow): Array<[string, string | number]> {
  const out: Array<[string, string | number]> = [];
  for (const col of FILL_COLUMNS) {
    if (!String(keep[col] ?? '').trim() && String(drop[col] ?? '').trim()) out.push([col, drop[col]]);
  }
  if (keep.employees == null && drop.employees != null) out.push(['employees', drop.employees]);
  if (!keep.owner_id && drop.owner_id) out.push(['owner_id', drop.owner_id]);
  if (!keep.parent_company_id && drop.parent_company_id && drop.parent_company_id !== keep.id) {
    out.push(['parent_company_id', drop.parent_company_id]);
  }
  const kc = parseCustom(keep.custom);
  const dc = parseCustom(drop.custom);
  let changed = false;
  for (const [k, v] of Object.entries(dc)) {
    const cur = kc[k];
    const empty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
    if (empty && v !== undefined && v !== null && v !== '') {
      kc[k] = v;
      changed = true;
    }
  }
  if (changed) out.push(['custom', JSON.stringify(kc)]);
  return out;
}

// ---------- DB ----------

export type CompanyDupRow = DupCandidate & { owner_id: string | null; city: string; country: string };

/** Grupos de empresas duplicadas del workspace (opcional: solo los que incluyen `companyId`). */
export async function findDuplicateCompanies(
  userId: string,
  opts: { companyId?: string } = {},
): Promise<CompanyDuplicateGroup<CompanyDupRow>[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, name, domain, created_at, owner_id, city, country FROM crm_companies
       WHERE user_id = ? ORDER BY created_at ASC LIMIT 20000`,
    )
    .all(userId)) as CompanyDupRow[];
  const groups = groupCompanyDuplicates(rows);
  return opts.companyId ? groups.filter((g) => g.companies.some((c) => c.id === opts.companyId)) : groups;
}

export type MergeCompaniesResult =
  | { ok: true; company: CrmCompanyRow }
  | { ok: false; reason: 'not_found' | 'same' };

/** Fusiona `dropId` en `keepId` (ver el comentario del módulo). */
export async function mergeCompanies(
  userId: string,
  keepId: string,
  dropId: string,
  actorEmail = '',
): Promise<MergeCompaniesResult> {
  if (keepId === dropId) return { ok: false, reason: 'same' };
  const db = getDb();
  const get = async (id: string) =>
    (await db.prepare('SELECT * FROM crm_companies WHERE id = ? AND user_id = ?').get(id, userId)) as
      | CrmCompanyRow
      | undefined;
  const keep = await get(keepId);
  const drop = await get(dropId);
  if (!keep || !drop) return { ok: false, reason: 'not_found' };

  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb: Db = txDb(tx);
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    // 1) Snapshot completo de la descartada (asociaciones, actividades, tags…).
    await trashRecords(userId, 'company', [dropId], actorEmail, tdb, { mergedInto: keepId, snapshotOnly: true });

    // 2) Contactos: pasan a la que queda; los que ya estaban en ambas pierden
    // la fila duplicada (y si la descartada era su primaria, lo es la que queda).
    const contacts = (await tdb
      .prepare('SELECT contact_id, is_primary FROM crm_contact_companies WHERE company_id = ?')
      .all(dropId)) as Array<{ contact_id: string; is_primary: number }>;
    await tdb
      .prepare('UPDATE OR IGNORE crm_contact_companies SET company_id = ? WHERE company_id = ?')
      .run(keepId, dropId);
    await tdb.prepare('DELETE FROM crm_contact_companies WHERE company_id = ?').run(dropId);
    for (const c of contacts.filter((x) => x.is_primary)) {
      await tdb
        .prepare(
          `UPDATE crm_contact_companies SET is_primary = 1 WHERE contact_id = ? AND company_id = ?
             AND NOT EXISTS (SELECT 1 FROM crm_contact_companies p WHERE p.contact_id = ? AND p.is_primary = 1)`,
        )
        .run(c.contact_id, keepId, c.contact_id);
    }

    // 3) Deals: igual.
    const deals = (await tdb
      .prepare('SELECT deal_id, is_primary FROM crm_deal_companies WHERE company_id = ?')
      .all(dropId)) as Array<{ deal_id: string; is_primary: number }>;
    await tdb.prepare('UPDATE OR IGNORE crm_deal_companies SET company_id = ? WHERE company_id = ?').run(keepId, dropId);
    await tdb.prepare('DELETE FROM crm_deal_companies WHERE company_id = ?').run(dropId);
    for (const d of deals.filter((x) => x.is_primary)) {
      await tdb
        .prepare(
          `UPDATE crm_deal_companies SET is_primary = 1 WHERE deal_id = ? AND company_id = ?
             AND NOT EXISTS (SELECT 1 FROM crm_deal_companies p WHERE p.deal_id = ? AND p.is_primary = 1)`,
        )
        .run(d.deal_id, keepId, d.deal_id);
    }

    // 4) Campos vacíos de la que queda.
    const fill = companyMergeFillPatch(keep, drop);
    await tdb
      .prepare(`UPDATE crm_companies SET ${['updated_at = ?', ...fill.map(([c]) => `${c} = ?`)].join(', ')} WHERE id = ?`)
      .run(ts, ...fill.map(([, v]) => v), keepId);

    // 5) Hijas, actividades, tags, archivos e historial.
    await tdb
      .prepare('UPDATE crm_companies SET parent_company_id = ? WHERE user_id = ? AND parent_company_id = ? AND id != ?')
      .run(keepId, userId, dropId, keepId);
    await tdb
      .prepare('UPDATE crm_companies SET parent_company_id = NULL WHERE id = ? AND parent_company_id = ?')
      .run(keepId, dropId);
    await tdb.prepare('UPDATE crm_activities SET company_id = ?, updated_at = ? WHERE company_id = ?').run(keepId, ts, dropId);
    await tdb
      .prepare("UPDATE OR IGNORE crm_record_tags SET record_id = ? WHERE entity = 'company' AND record_id = ?")
      .run(keepId, dropId);
    await tdb.prepare('UPDATE crm_record_files SET company_id = ? WHERE company_id = ?').run(keepId, dropId);
    await tdb
      .prepare("UPDATE crm_property_events SET entity_id = ? WHERE user_id = ? AND entity = 'company' AND entity_id = ?")
      .run(keepId, userId, dropId);
    await tdb.prepare('UPDATE crm_contacts SET company_id = ? WHERE user_id = ? AND company_id = ?').run(keepId, userId, dropId);

    // 6) Borra la descartada (lo que no se pudo mover se va en cascada; está en el snapshot).
    await tdb.prepare('DELETE FROM crm_companies WHERE id = ? AND user_id = ?').run(dropId, userId);
    for (const c of contacts) await syncContactPrimary(c.contact_id, tdb);
    for (const d of deals) await syncDealPrimary(d.deal_id, tdb);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  const company = (await get(keepId))!;
  return { ok: true, company };
}
