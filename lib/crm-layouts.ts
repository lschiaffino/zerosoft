/**
 * CRM — vista previa y tarjetas del board configurables. Server-only. Lo
 * puro (catálogo, limpieza, defaults) está en lib/crm-layouts-shared.ts.
 *
 * La configuración es del workspace y la cambian owner y admins (la ruta lo
 * exige). Lo que recibe cada persona pasa por sus permisos por campo: una
 * propiedad personalizada que tiene oculta no aparece en su configuración,
 * aunque un admin la haya puesto en la vista previa o en las tarjetas.
 */
import { getDb, type Db } from './db';
import { hiddenFieldsFor, type FieldViewer } from './crm-field-perms';
import {
  defaultCardLayout,
  defaultPreviewLayout,
  sanitizeCardLayout,
  sanitizePreviewLayout,
  withoutHidden,
  type CardLayout,
  type LayoutEntity,
  type PreviewLayout,
} from './crm-layouts-shared';

type Kind = 'preview' | 'card';

function parse(json: string | null | undefined): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function customNames(workspaceId: string, entity: LayoutEntity, db: Db): Promise<Set<string>> {
  const rows = (await db
    .prepare('SELECT name FROM crm_custom_fields WHERE user_id = ? AND entity = ?')
    .all(workspaceId, entity)) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

async function readRow(workspaceId: string, kind: Kind, entity: LayoutEntity, scope: string, db: Db): Promise<Record<string, unknown> | null> {
  const row = (await db
    .prepare('SELECT config FROM crm_record_layouts WHERE user_id = ? AND kind = ? AND entity = ? AND scope = ?')
    .get(workspaceId, kind, entity, scope)) as { config: string } | undefined;
  return row ? parse(row.config) : null;
}

async function writeRow(workspaceId: string, kind: Kind, entity: LayoutEntity, scope: string, config: object, db: Db): Promise<void> {
  await db
    .prepare(
      `INSERT INTO crm_record_layouts (user_id, kind, entity, scope, config, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, kind, entity, scope) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at`,
    )
    .run(workspaceId, kind, entity, scope, JSON.stringify(config));
}

/** ¿El pipeline es del workspace? */
export async function pipelineInWorkspace(workspaceId: string, pipelineId: string, db: Db = getDb()): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM crm_pipelines WHERE id = ? AND user_id = ?').get(pipelineId, workspaceId));
}

// ---------- Vista previa ----------

/** Configuración guardada (o la de por defecto), sin claves que ya no existen. Sin filtrar por persona. */
export async function getPreviewLayout(workspaceId: string, entity: LayoutEntity, db: Db = getDb()): Promise<PreviewLayout> {
  const raw = await readRow(workspaceId, 'preview', entity, '', db);
  if (!raw) return defaultPreviewLayout(entity);
  return sanitizePreviewLayout(entity, raw, await customNames(workspaceId, entity, db));
}

export async function setPreviewLayout(
  workspaceId: string,
  entity: LayoutEntity,
  input: { properties?: unknown; sections?: unknown },
  db: Db = getDb(),
): Promise<PreviewLayout> {
  const clean = sanitizePreviewLayout(entity, input, await customNames(workspaceId, entity, db));
  await writeRow(workspaceId, 'preview', entity, '', clean, db);
  return clean;
}

/** La vista previa para esta persona: sin las personalizadas que tiene ocultas. */
export async function resolvePreviewLayout(viewer: FieldViewer, entity: LayoutEntity, db: Db = getDb()): Promise<PreviewLayout> {
  const layout = await getPreviewLayout(viewer.workspaceId, entity, db);
  return withoutHidden(layout, await hiddenFieldsFor(viewer, entity, db));
}

// ---------- Tarjetas del board de deals (por pipeline) ----------

export async function getCardLayout(workspaceId: string, pipelineId: string, db: Db = getDb()): Promise<CardLayout> {
  const raw = await readRow(workspaceId, 'card', 'deals', pipelineId, db);
  if (!raw) return defaultCardLayout();
  return sanitizeCardLayout(raw, await customNames(workspaceId, 'deals', db));
}

/** Guarda las tarjetas de un pipeline del workspace. null si el pipeline no es del workspace. */
export async function setCardLayout(
  workspaceId: string,
  pipelineId: string,
  input: { properties?: unknown },
  db: Db = getDb(),
): Promise<CardLayout | null> {
  if (!(await pipelineInWorkspace(workspaceId, pipelineId, db))) return null;
  const clean = sanitizeCardLayout(input, await customNames(workspaceId, 'deals', db));
  await writeRow(workspaceId, 'card', 'deals', pipelineId, clean, db);
  return clean;
}

/** Las tarjetas para esta persona: sin las personalizadas que tiene ocultas. */
export async function resolveCardLayout(viewer: FieldViewer, pipelineId: string, db: Db = getDb()): Promise<CardLayout> {
  const layout = await getCardLayout(viewer.workspaceId, pipelineId, db);
  return withoutHidden(layout, await hiddenFieldsFor(viewer, 'deals', db));
}

/** Vuelve a lo de por defecto. */
export async function resetLayout(workspaceId: string, kind: Kind, entity: LayoutEntity, scope: string, db: Db = getDb()): Promise<void> {
  await db
    .prepare('DELETE FROM crm_record_layouts WHERE user_id = ? AND kind = ? AND entity = ? AND scope = ?')
    .run(workspaceId, kind, entity, scope);
}
