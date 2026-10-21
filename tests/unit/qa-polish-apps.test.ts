import { describe, expect, it } from 'vitest';
import { notificationTitle, type NotificationTextLabels } from '@/lib/notification-text';
import { normalizeTemplateTitle, templateCreateSchema } from '@/lib/track-schema';
import { createProject, DEFAULT_STATUS_NAMES } from '@/lib/track-data';
import { getDb } from '@/lib/db';
import { autoConnectHandle } from '@/components/flow/flow-ui';
import { editorLocations, legacyLocationOption } from '@/lib/calendar-locations';
import { checkBulkRows, parseBulkLines } from '@/lib/link-bulk-csv';
import { aiProviderErrorCode, runErrorCode } from '@/lib/agents-http';
import { createAgent } from '@/lib/agents';
import { makeUser } from './helpers';

const ES: NotificationTextLabels = {
  someone: 'Alguien',
  untitled: 'Sin título',
  mentionedYou: '{actor} te mencionó en {identifier}',
  assignedYou: '{actor} te asignó {identifier}',
  commentedOn: '{actor} comentó en {identifier}',
  changedStatus: '{actor} cambió el estado de {identifier}',
  updatedIssue: '{actor} actualizó {identifier}',
  reminderFor: 'Recordatorio de {identifier}',
  docMention: '{actor} te mencionó en {title}',
  docCommentMention: '{actor} te mencionó en un comentario de {title}',
  docCommentReply: '{actor} respondió un comentario en {title}',
  docShared: '{actor} compartió {title} con vos',
  boardMention: '{actor} te mencionó en {title}',
  boardReply: '{actor} respondió en {title}',
};

describe('Avisos: título en el idioma de quien lee', () => {
  it('arma los de Track, Docs y Board con meta y deja el resto como vino', () => {
    const reminder = { type: 'track_reminder', title: 'Reminder: LAN-5', source_type: 'track_issue', meta: '{"issueIdentifier":"LAN-5"}' };
    expect(notificationTitle(reminder, ES)).toBe('Recordatorio de LAN-5');
    expect(
      notificationTitle({ type: 'assigned', title: 'Ana assigned you X-1', source_type: 'track_issue', meta: { actorName: 'Ana', issueIdentifier: 'X-1' } }, ES),
    ).toBe('Ana te asignó X-1');
    expect(notificationTitle({ type: 'mention', title: 'x', source_type: 'docs_page', meta: '{"actorName":"Bo","pageTitle":""}' }, ES)).toBe(
      'Bo te mencionó en Sin título',
    );
    expect(notificationTitle({ type: 'comment', title: 'x', source_type: 'docs_page', meta: '{"actorName":"Bo","pageTitle":"Plan","shared":true}' }, ES)).toBe(
      'Bo compartió Plan con vos',
    );
    expect(notificationTitle({ type: 'comment', title: 'x', source_type: 'docs_comment', meta: '{"actorName":"Bo","pageTitle":"Plan","reply":true}' }, ES)).toBe(
      'Bo respondió un comentario en Plan',
    );
    expect(notificationTitle({ type: 'mention', title: 'x', source_type: 'board_comment', meta: '{"boardName":"Q4"}' }, ES)).toBe('Alguien te mencionó en Q4');
    // Sin datos para armarlo, o de otra app: el título guardado.
    expect(notificationTitle({ type: 'track_reminder', title: 'Reminder: ?', source_type: 'track_issue', meta: '{}' }, ES)).toBe('Reminder: ?');
    expect(notificationTitle({ type: 'crm_quote', title: 'Cotización 7 aceptada', source_type: 'crm_quote', meta: 'roto' }, ES)).toBe('Cotización 7 aceptada');
  });
});

describe('Track: plantillas y estados por defecto', () => {
  it('el título de plantilla conserva un espacio final', () => {
    expect(normalizeTemplateTitle('[Bug] ')).toBe('[Bug] ');
    expect(normalizeTemplateTitle('  [Bug]   ')).toBe('[Bug] ');
    expect(normalizeTemplateTitle('[Bug]')).toBe('[Bug]');
    expect(normalizeTemplateTitle('   ')).toBe('');
    expect(templateCreateSchema.parse({ name: 'Bug', title: '[Bug] ' }).title).toBe('[Bug] ');
  });

  it('los estados nacen en el idioma de quien crea el proyecto', async () => {
    const u = await makeUser('tr-loc');
    const statuses = async (id: string) =>
      ((await getDb().prepare('SELECT name FROM track_statuses WHERE project_id = ? ORDER BY position').all(id)) as Array<{ name: string }>).map(
        (r) => r.name,
      );
    const es = await createProject(u.id, null, { name: 'ES' }, { locale: 'es' });
    expect(await statuses(es.id)).toEqual(['Backlog', 'Por hacer', 'En progreso', 'Hecho', 'Cancelado']);
    const en = await createProject(u.id, null, { name: 'EN' });
    expect(await statuses(en.id)).toEqual(Object.values(DEFAULT_STATUS_NAMES.en));
    const odd = await createProject(u.id, null, { name: 'XX' }, { locale: 'fr' });
    expect(await statuses(odd.id)).toEqual(Object.values(DEFAULT_STATUS_NAMES.en));
  });
});

describe('Flow: autoconexión del nodo nuevo', () => {
  it('usa la única salida o la primera libre, nunca la de error', () => {
    expect(autoConnectHandle(['out'], ['out'])).toBe('out');
    expect(autoConnectHandle(['approved', 'rejected'], [])).toBe('approved');
    expect(autoConnectHandle(['approved', 'rejected'], ['approved'])).toBe('rejected');
    expect(autoConnectHandle(['approved', 'rejected'], ['approved', 'rejected'])).toBeNull();
    expect(autoConnectHandle(['out', 'error'], ['out'])).toBeNull();
  });
});

describe('Cal: el texto de ubicación viejo pasa a la lista', () => {
  it('reconoce links, teléfonos y direcciones', () => {
    expect(legacyLocationOption('https://us02web.zoom.us/j/123')).toEqual({ kind: 'zoom', value: 'https://us02web.zoom.us/j/123' });
    expect(legacyLocationOption('https://teams.microsoft.com/l/x')).toEqual({ kind: 'teams', value: 'https://teams.microsoft.com/l/x' });
    expect(legacyLocationOption('https://meet.google.com/new')).toEqual({ kind: 'link', value: 'https://meet.google.com/new' });
    expect(legacyLocationOption('+54 11 5555-1234')).toEqual({ kind: 'phone_invitee', value: '+54 11 5555-1234' });
    expect(legacyLocationOption('Av. Corrientes 1234')).toEqual({ kind: 'in_person', value: 'Av. Corrientes 1234' });
    expect(legacyLocationOption('  ')).toBeNull();
  });

  it('la lista guardada gana; si está vacía, entra el texto viejo', () => {
    const saved = JSON.stringify([{ kind: 'google_meet', value: '' }]);
    expect(editorLocations(saved, 'Oficina')).toEqual([{ kind: 'google_meet', value: '' }]);
    expect(editorLocations('[]', 'Oficina')).toEqual([{ kind: 'in_person', value: 'Oficina' }]);
    expect(editorLocations(null, '')).toEqual([]);
  });
});

describe('Link: revisión previa del alta masiva', () => {
  it('marca URL inválida, slug inválido y slug repetido en el lote', () => {
    const rows = checkBulkRows(
      parseBulkLines(
        ['https://example.com/uno', 'no-es-url', 'https://example.com/dos, promo-qa, Promo', 'https://example.com/tres, promo-qa, Otra', 'https://example.com/x, app'].join(
          '\n',
        ),
      ),
    );
    expect(rows.map((r) => r.problem)).toEqual([null, 'invalid_url', null, 'duplicate_slug', 'invalid_slug']);
    // En un dominio propio "app" no está reservado.
    expect(checkBulkRows([{ url: 'https://example.com', slug: 'app' }], { customDomain: true })[0].problem).toBeNull();
  });
});

describe('Agents: errores del proveedor de AI y la plantilla de soporte', () => {
  it('reconoce falta de créditos, credenciales y rate limit, también en el cause', () => {
    const freeTier = Object.assign(new Error('Free tier users do not have access to this model.'), { name: 'GatewayInternalServerError' });
    expect(aiProviderErrorCode(freeTier)).toBe('ai_no_credits');
    expect(aiProviderErrorCode(new Error('wrapped', { cause: { statusCode: 402, message: 'x' } }))).toBe('ai_no_credits');
    expect(aiProviderErrorCode(Object.assign(new Error('bad key'), { name: 'GatewayAuthenticationError' }))).toBe('ai_auth');
    expect(aiProviderErrorCode({ statusCode: 429, message: 'slow down' })).toBe('rate_limited');
    expect(aiProviderErrorCode(new Error('boom'))).toBeNull();
    const original = console.warn;
    console.warn = () => undefined;
    try {
      expect(runErrorCode(freeTier)).toEqual({ code: 'ai_no_credits', status: 502 });
    } finally {
      console.warn = original;
    }
  });

  it('"Crear issue en Track" arranca con un proyecto o apagada', async () => {
    const empty = await makeUser('ag-noproj');
    const a = await createAgent(empty.id, empty.id, { name: 'Soporte', template: 'support' });
    expect(a.tools.enabled).not.toContain('track_create_issue');
    expect(a.tools.trackProjectId).toBeNull();

    const withProject = await makeUser('ag-proj');
    const project = await createProject(withProject.id, null, { name: 'Soporte' });
    const b = await createAgent(withProject.id, withProject.id, { name: 'Soporte', template: 'support' });
    expect(b.tools.enabled).toContain('track_create_issue');
    expect(b.tools.trackProjectId).toBe(project.id);
  });
});
