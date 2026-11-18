import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { ensureWorkspace } from '@/lib/workspace';
import { createForm, deleteForm, getForm, updateForm } from '@/lib/forms/core';
import { listResponses, purgeFormsRetention, savePartial, submitResponse as rawSubmit, uploadPublicFile, type SubmitBody } from '@/lib/forms/responses';
import { listFormTrash, restoreFormTrash } from '@/lib/forms/trash';
import { readFormFile } from '@/lib/forms/files';
import { renderToken } from '@/lib/forms/render-token';
import { getSoftDeleted, purgeDueSoftDeleted } from '@/lib/soft-delete';
import type { FormsActor } from '@/lib/forms/types';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-forms-sd-uploads-${process.pid}`);
process.env.RATE_LIMIT_DISABLED = 'true';

// Hora congelada: todo se mide contra NOW, nunca contra el reloj.
const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const later = (days: number) => new Date(NOW.getTime() + days * DAY);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

const uid = () => Math.random().toString(36).slice(2, 10);
const submit = (slug: string, body: SubmitBody) => rawSubmit(slug, { renderToken: renderToken(slug, Date.now() - 5000), ...body });

async function owner(): Promise<FormsActor> {
  const o = await upsertUser({ email: `forms-sd-${uid()}@example.com`, name: 'Owner', image: null });
  await ensureWorkspace(o.id);
  return { ws: o.id, person: o.id, admin: true, crm: true };
}

async function jobForm(actor: FormsActor, retentionDays: number) {
  const f = await createForm(actor, { name: `Job ${uid()}`, template: 'job', lang: 'en' });
  return (await updateForm(actor, f.id, { status: 'published', settings: { retentionDays, partials: true } }))!;
}

/** Envío con CV (obligatorio en la plantilla); la fecha del envío queda en `submittedAt`. */
async function respond(slug: string, submittedAt: string) {
  const file = await uploadPublicFile(slug, 'q_cv', { bytes: PDF, filename: 'cv.pdf' });
  const res = await submit(slug, { answers: { q_name: `N ${uid()}`, q_email: `${uid()}@example.com`, q_role: 'c1', q_cv: file }, consent: true });
  if (!res.ok) throw new Error('submit failed');
  const id = res.responseId!;
  await getDb().prepare('UPDATE forms_responses SET submitted_at = ?, updated_at = ?, created_at = ? WHERE id = ?').run(submittedAt, submittedAt, submittedAt, id);
  const ref = ((await getDb().prepare('SELECT ref FROM forms_files WHERE id = ?').get(file.fileId)) as { ref: string }).ref;
  return { id, ref, fileId: file.fileId };
}

const ids = async (actor: FormsActor, formId: string, status?: 'partial') => (await listResponses(actor, formId, status ? { status } : {}))!.rows.map((r) => r.id);

describe('Forms: la retención manda a la papelera', () => {
  it('saca de la app lo que entra en la gracia, con sus archivos, y la purga cae en el plazo de siempre', async () => {
    const a = await owner();
    const f = await jobForm(a, 90);
    await respond(f.slug, ago(100));
    const inGrace = await respond(f.slug, ago(70));
    const fresh = await respond(f.slug, ago(50));
    expect((await getForm(a, f.id))!.responseCount).toBe(3);

    const res = await purgeFormsRetention(NOW);
    expect(res.responses).toBe(2);
    expect(await ids(a, f.id)).toEqual([fresh.id]);
    // El contador del form libera los dos lugares.
    expect((await getForm(a, f.id))!.responseCount).toBe(1);
    // La fila del archivo sale con la respuesta; el archivo queda hasta la purga.
    expect(await getDb().prepare('SELECT 1 FROM forms_files WHERE id = ?').get(inGrace.fileId)).toBeUndefined();
    expect(await readFormFile(inGrace.ref)).not.toBeNull();

    const trash = await listFormTrash(a, f.id);
    expect(trash).toHaveLength(2);
    const byDate = Object.fromEntries(trash.map((t) => [t.date, t]));
    // Lo vencido se purga en el próximo tick; lo de la gracia, exactamente a los 90 días del envío.
    expect(byDate[ago(100)].purgeAt).toBe(NOW.toISOString());
    expect(byDate[ago(70)].purgeAt).toBe(later(20).toISOString());
    expect(trash.every((t) => t.kind === 'response')).toBe(true);
    // Correr otra vez no duplica nada.
    expect((await purgeFormsRetention(NOW)).responses).toBe(0);
  });

  it('el cron purga en el plazo, ni un tick antes, y borra el archivo', async () => {
    const a = await owner();
    const f = await jobForm(a, 90);
    const r = await respond(f.slug, ago(70));
    await purgeFormsRetention(NOW);
    const [entry] = await listFormTrash(a, f.id);
    expect(entry.purgeAt).toBe(later(20).toISOString());

    await purgeDueSoftDeleted(new Date(later(20).getTime() - 60_000));
    expect(await getSoftDeleted(a.ws, 'forms', entry.id)).not.toBeNull();
    expect(await readFormFile(r.ref)).not.toBeNull();

    await purgeDueSoftDeleted(later(20));
    expect(await getSoftDeleted(a.ws, 'forms', entry.id)).toBeNull();
    expect(await readFormFile(r.ref)).toBeNull();
    expect(await listFormTrash(a, f.id)).toEqual([]);
  });

  it('restaurar devuelve la respuesta con su archivo y su lugar, y la retención cuenta desde ahí', async () => {
    const a = await owner();
    const f = await jobForm(a, 90);
    const r = await respond(f.slug, ago(70));
    await purgeFormsRetention(NOW);
    expect(await ids(a, f.id)).toEqual([]);
    const [entry] = await listFormTrash(a, f.id);

    const back = await restoreFormTrash(a, f.id, entry.id, NOW);
    expect(back.id).toBe(entry.id);
    expect(await ids(a, f.id)).toEqual([r.id]);
    expect((await getForm(a, f.id))!.responseCount).toBe(1);
    expect(await getDb().prepare('SELECT 1 FROM forms_files WHERE id = ? AND response_id = ?').get(r.fileId, r.id)).toBeDefined();
    expect(await listFormTrash(a, f.id)).toEqual([]);

    // Ya restaurada, la próxima corrida no la vuelve a sacar: cuenta desde la restauración.
    expect((await purgeFormsRetention(later(1))).responses).toBe(0);
    expect(await ids(a, f.id)).toEqual([r.id]);
    // A los 60 días de restaurada entra otra vez en la gracia, con purga a los 90.
    await purgeFormsRetention(later(61));
    const [again] = await listFormTrash(a, f.id);
    expect(again.purgeAt).toBe(later(90).toISOString());
    // Lo restaurado ya no está en la papelera: restaurar de nuevo la misma entrada no existe.
    await expect(restoreFormTrash(a, f.id, entry.id, NOW)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('parciales abandonadas: papelera a los 20 días, purga a los 30, restaurables', async () => {
    const a = await owner();
    const f = await jobForm(a, 0);
    await savePartial(f.slug, { answers: { q_name: 'Old' }, consent: true });
    await savePartial(f.slug, { answers: { q_name: 'Fresh' }, consent: true });
    const rows = (await getDb().prepare("SELECT id, answers FROM forms_responses WHERE form_id = ? AND status = 'partial'").all(f.id)) as Array<{ id: string; answers: string }>;
    const old = rows.find((r) => r.answers.includes('Old'))!;
    const fresh = rows.find((r) => r.answers.includes('Fresh'))!;
    await getDb().prepare('UPDATE forms_responses SET updated_at = ? WHERE id = ?').run(ago(25), old.id);
    await getDb().prepare('UPDATE forms_responses SET updated_at = ? WHERE id = ?').run(ago(15), fresh.id);

    const res = await purgeFormsRetention(NOW);
    expect(res.partials).toBeGreaterThanOrEqual(1);
    expect(await ids(a, f.id, 'partial')).toEqual([fresh.id]);
    const [entry] = await listFormTrash(a, f.id);
    expect(entry.kind).toBe('partial');
    expect(entry.purgeAt).toBe(later(5).toISOString());

    await restoreFormTrash(a, f.id, entry.id, NOW);
    expect((await ids(a, f.id, 'partial')).sort()).toEqual([fresh.id, old.id].sort());
    // Una parcial restaurada no suma al contador de respuestas completas.
    expect((await getForm(a, f.id))!.responseCount).toBe(0);
  });

  it('dos corridas a la vez mandan cada respuesta una sola vez', async () => {
    const a = await owner();
    const f = await jobForm(a, 30);
    for (let i = 0; i < 3; i++) await respond(f.slug, ago(40));
    const [x, y] = await Promise.all([purgeFormsRetention(NOW), purgeFormsRetention(NOW)]);
    expect(x.responses + y.responses).toBe(3);
    expect(await listFormTrash(a, f.id)).toHaveLength(3);
    expect((await getForm(a, f.id))!.responseCount).toBe(0);
  });

  it('solo quien tiene acceso al form ve y restaura; borrar el form purga su papelera', async () => {
    const a = await owner();
    const b = await owner();
    const f = await jobForm(a, 90);
    const g = await jobForm(a, 90);
    const r = await respond(f.slug, ago(70));
    await purgeFormsRetention(NOW);
    const [entry] = await listFormTrash(a, f.id);

    await expect(listFormTrash(b, f.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(restoreFormTrash(b, f.id, entry.id, NOW)).rejects.toMatchObject({ code: 'not_found' });
    // La entrada de otro form no se restaura desde este.
    await expect(restoreFormTrash(a, g.id, entry.id, NOW)).rejects.toMatchObject({ code: 'not_found' });
    expect(await listFormTrash(a, g.id)).toEqual([]);

    expect(await deleteForm(a, f.id)).toBe(true);
    expect(await getSoftDeleted(a.ws, 'forms', entry.id)).toBeNull();
    expect(await readFormFile(r.ref)).toBeNull();
  });
});
