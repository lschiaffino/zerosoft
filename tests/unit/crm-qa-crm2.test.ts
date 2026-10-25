import { describe, expect, it } from 'vitest';
import { createActivity, createContact, listTasks, updateActivity } from '@/lib/crm';
import { listQueueTasks } from '@/lib/crm-work-queue';
import { getDb } from '@/lib/db';
import { formatAxis, formatDate } from '@/lib/utils';
import { formatCallDuration, formatPhoneDisplay } from '@/lib/crm-calls';
import { customKind, kindFits, standardKind } from '@/lib/crm-playbooks-schema';
import { localUploadPath, parseRange } from '@/lib/crm-media-file';
import { makeUser } from './helpers';

async function contactDates(id: string) {
  return (await getDb().prepare('SELECT last_contacted_at, next_activity_at FROM crm_contacts WHERE id = ?').get(id)) as {
    last_contacted_at: string | null;
    next_activity_at: string | null;
  };
}

describe('tareas de llamada y email (task_kind)', () => {
  it('son tareas pendientes: aparecen en Tasks y en la cola, y no cuentan como contacto hasta completarse', async () => {
    const u = await makeUser('taskkind');
    const c = await createContact(u.id, { firstName: 'Kind', email: 'kind@x.io' });
    const due = '2020-01-01 10:00';
    const call = await createActivity(u.id, { type: 'task', taskKind: 'call', subject: 'Llamar a Kind', dueAt: due, contactId: c.id });
    const email = await createActivity(u.id, { type: 'task', taskKind: 'email', subject: 'Mandar propuesta', dueAt: due, contactId: c.id });
    expect(call.type).toBe('task');
    expect(call.task_kind).toBe('call');

    const overdue = await listTasks(u.id, 'overdue');
    expect(overdue.map((t) => t.id)).toEqual(expect.arrayContaining([call.id, email.id]));
    const queue = await listQueueTasks(u.id, { scope: 'due' });
    expect(queue.find((t) => t.id === call.id)?.kind).toBe('call');
    expect(queue.find((t) => t.id === email.id)?.kind).toBe('email');

    let dates = await contactDates(c.id);
    expect(dates.last_contacted_at).toBeNull();
    expect(dates.next_activity_at).toBeTruthy();

    await updateActivity(u.id, call.id, { done: true });
    dates = await contactDates(c.id);
    expect(dates.last_contacted_at).toBeTruthy();
  });

  it('una nota con task_kind no lo guarda (solo las tareas tienen tipo)', async () => {
    const u = await makeUser('taskkind-note');
    const n = await createActivity(u.id, { type: 'note', taskKind: 'call', subject: 'Nota' });
    expect(n.task_kind).toBe('');
  });
});

describe('fechas sin hora', () => {
  it('formatDate muestra el día del calendario (no el anterior por la zona horaria)', () => {
    expect(formatDate('2026-10-30', 'en')).toBe('Oct 30, 2026');
    expect(formatDate('2026-01-01', 'es')).toContain('2026');
    expect(formatDate('2026-01-01', 'es')).toMatch(/^1 /);
  });
});

describe('formatos de llamadas y gráficos', () => {
  it('teléfono E.164 legible', () => {
    expect(formatPhoneDisplay('+14155550132')).toBe('+1 415 555 0132');
    expect(formatPhoneDisplay('+5491155550101')).toBe('+54 9 11 5555-0101');
    expect(formatPhoneDisplay('+54 9 11 5555 0100')).toBe('+54 9 11 5555-0100');
    expect(formatPhoneDisplay('+5491155550100')).toBe('+54 9 11 5555-0100');
    expect(formatPhoneDisplay('+541145678900')).toBe('+54 11 4567-8900');
    expect(formatPhoneDisplay('+5493514123456')).toBe('+54 9 351 412-3456');
    expect(formatPhoneDisplay('+5492944123456')).toBe('+54 9 2944 12-3456');
    expect(formatPhoneDisplay('+5511912345678')).toBe('+55 11 91234-5678');
    expect(formatPhoneDisplay('+525512345678')).toBe('+52 55 1234 5678');
    expect(formatPhoneDisplay('+59899123456')).toBe('+598 9912 3456');
    expect(formatPhoneDisplay('11 5555 0100')).toBe('11 5555 0100');
  });
  it('duración: segundos debajo del minuto', () => {
    expect(formatCallDuration(7)).toBe('7 s');
    expect(formatCallDuration(59.6)).toBe('1 min');
    expect(formatCallDuration(185)).toBe('3 min');
  });
  it('ejes sin decimales largos', () => {
    expect(formatAxis(33.333333, 'en')).toBe('33');
    expect(formatAxis(0.6666, 'en')).toBe('0.7');
    expect(formatAxis(120000, 'en')).toBe('120K');
    expect(formatAxis(0, 'en')).toBe('0');
  });
});

describe('playbooks: dónde guardar la respuesta', () => {
  it('cada tipo de pregunta solo ofrece propiedades compatibles', () => {
    expect(kindFits(standardKind('deal:amount'), 'number')).toBe(true);
    expect(kindFits(standardKind('deal:amount'), 'text')).toBe(false);
    expect(kindFits(standardKind('deal:closeDate'), 'date')).toBe(true);
    expect(kindFits(standardKind('contact:lifecycleStage'), 'select')).toBe(true);
    expect(kindFits(standardKind('contact:lifecycleStage'), 'text')).toBe(false);
    expect(kindFits(standardKind('contact:jobTitle'), 'longtext')).toBe(true);
    expect(customKind('currency')).toBe('number');
    expect(customKind('select')).toBe('enum');
    expect(customKind('boolean')).toBeNull();
    expect(kindFits(customKind('url')!, 'text')).toBe(true);
    expect(kindFits(customKind('date')!, 'number')).toBe(false);
  });
});

describe('archivos del CRM por ruta API', () => {
  it('rangos de bytes', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=200-300', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
  it('solo subidas locales del CRM, sin salirse de la carpeta', () => {
    expect(localUploadPath('/uploads/crm/a.pdf')).toMatch(/public\/uploads\/crm\/a\.pdf$/);
    expect(localUploadPath('/uploads/crm/../../.env')).toBeNull();
    expect(localUploadPath('/uploads/docs/a.pdf')).toBeNull();
    expect(localUploadPath('https://x.public.blob.vercel-storage.com/crm/a.pdf')).toBeNull();
  });
});
