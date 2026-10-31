import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordProjectId } from '@/lib/analytics/guard';
import { createProject } from '@/lib/analytics/projects';
import { getDb } from '@/lib/db';
import { localized, recipientLocale, renderLocalized } from '@/lib/notification-copy';
import { createNotification } from '@/lib/notifications';
import { appFromPath, hrefAllowed, PRODUCT_KEYS } from '@/lib/products';
import { addMember, createTeam } from '@/lib/teams';
import { resolveTalkChannelRoute } from '@/lib/talk-guests';
import { appFromPath as fromWorkspace } from '@/lib/workspace';
import type { SessionUser } from '@/lib/session';
import { makeUser } from './helpers';

const root = join(__dirname, '..', '..');
const LOCALES = ['en', 'es', 'pt'] as const;
const messages = (locale: string) => JSON.parse(readFileSync(join(root, `messages/${locale}/notificationCopy.json`), 'utf8')) as Record<string, string>;

describe('Cmd+K por app', () => {
  it('un destino de una app bloqueada no se ofrece', () => {
    expect(hrefAllowed(['docs'], '/app/crm/contacts/new')).toBe(false);
    expect(hrefAllowed(['docs'], '/app/docs')).toBe(true);
    expect(hrefAllowed('*', '/app/crm/contacts/new')).toBe(true);
    expect(hrefAllowed([], '/app/crm')).toBe(false);
  });

  it('lo que no es de una app sigue, y la app explícita manda sobre la ruta', () => {
    expect(hrefAllowed(['docs'], '/app')).toBe(true);
    expect(hrefAllowed(['docs'], '/app/settings')).toBe(true);
    expect(hrefAllowed(['docs'], '/app/settings/import?source=hubspot', 'crm')).toBe(false);
    expect(hrefAllowed(['crm'], '/app/settings/import?source=hubspot', 'crm')).toBe(true);
  });

  it('toda app de la suite se reconoce por su ruta, en cliente y en servidor', () => {
    for (const key of PRODUCT_KEYS) {
      expect(hrefAllowed([], `/app/${key === 'link' ? 'links' : key === 'cal' ? 'calendar' : key}/x`), key).toBe(false);
    }
    expect(fromWorkspace).toBe(appFromPath);
  });
});

describe('avisos en el idioma de quien recibe', () => {
  it('los tres idiomas tienen las mismas claves y variables', () => {
    const en = messages('en');
    for (const locale of LOCALES) {
      const copy = messages(locale);
      expect(Object.keys(copy).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(vars(copy[key]), `${locale}.${key}`).toEqual(vars(en[key]));
        expect(copy[key], `${locale}.${key}`).not.toContain('—');
      }
    }
  });

  it('un dato no se vuelve a interpretar y lo que falta tiene respaldo', () => {
    expect(renderLocalized(localized('formResponse', { name: '{who}' }), 'es')).toBe('Respuesta nueva en "{who}"');
    expect(renderLocalized(localized('documentOpened', { who: undefined, name: 'Propuesta' }), 'es')).toBe('Alguien abrió "Propuesta"');
    expect(renderLocalized(localized('docsSuggestedOne', { who: 'Ana', title: '' }), 'pt')).toBe('Ana sugeriu uma edição em Sem título');
  });

  it('usa el idioma de la persona; sin él, el del workspace; sin nada, inglés', async () => {
    const db = getDb();
    const owner = await makeUser('own');
    const member = await makeUser('mem');
    const team = await createTeam(owner.id, 'T');
    await addMember(team.id, member.id, 'member');
    await db.prepare('UPDATE users SET locale = NULL WHERE id IN (?, ?)').run(owner.id, member.id);
    expect(await recipientLocale(member.id)).toBe('en');
    await db.prepare("UPDATE users SET locale = 'pt' WHERE id = ?").run(owner.id);
    expect(await recipientLocale(member.id)).toBe('pt');
    await db.prepare("UPDATE users SET locale = 'es' WHERE id = ?").run(member.id);
    expect(await recipientLocale(member.id)).toBe('es');
  });

  it('se guarda traducido; un texto hecho queda como vino', async () => {
    const person = await makeUser('rcv');
    await getDb().prepare("UPDATE users SET locale = 'es' WHERE id = ?").run(person.id);
    const row = await createNotification({
      userId: person.id,
      type: 'crm_quote',
      title: localized('quotePaid', { number: 'Q-7' }),
      body: 'cuerpo',
      sourceType: 't',
      sourceId: 't',
    });
    expect(row.title).toBe('Pagaron la cotización Q-7');
    expect(row.body).toBe('cuerpo');
    const plain = await createNotification({ userId: person.id, type: 'crm_quote', title: 'Título', sourceType: 't', sourceId: 't' });
    expect(plain.title).toBe('Título');
  });
});

describe('guardas por workspace', () => {
  it('Analytics: el registro de un proyecto de otro workspace no aparece', async () => {
    const a = await makeUser('anA');
    const b = await makeUser('anB');
    const project = await createProject(a.id, a.id, 'P');
    const ts = new Date().toISOString();
    await getDb()
      .prepare("INSERT INTO analytics_dashboards (id, project_id, name, created_by, created_at, updated_at) VALUES ('ad_x1', ?, 'x', ?, ?, ?)")
      .run(project.id, a.id, ts, ts);
    expect(await recordProjectId('dashboards', 'ad_x1', a.id)).toBe(project.id);
    expect(await recordProjectId('dashboards', 'ad_x1', b.id)).toBeNull();
    expect(await recordProjectId('dashboards', 'ad_nope', a.id)).toBeNull();
    await getDb().prepare('UPDATE analytics_projects SET deleted_at = 1 WHERE id = ?').run(project.id);
    expect(await recordProjectId('dashboards', 'ad_x1', a.id)).toBeNull();
  });

  it('Talk: ajeno e inventado dan lo mismo; invitada cambia de workspace', async () => {
    const owner = await makeUser('tkO');
    const guest = await makeUser('tkG');
    const stranger = await makeUser('tkS');
    const ts = new Date().toISOString();
    const db = getDb();
    await db
      .prepare("INSERT INTO talk_channels (id, workspace_id, kind, name, created_by, created_at, updated_at) VALUES ('ch_r2', ?, 'private', 'x', ?, ?, ?)")
      .run(owner.id, owner.id, ts, ts);
    await db.prepare("INSERT INTO talk_guests (workspace_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?)").run(owner.id, guest.id, owner.id, ts);
    const session = (u: { id: string; email: string; name: string | null }) => ({ ...u, role: 'owner', team: null, workspace: null, apps: '*' }) as unknown as SessionUser;
    expect(await resolveTalkChannelRoute(session(stranger), 'ch_r2')).toEqual({ kind: 'missing' });
    expect(await resolveTalkChannelRoute(session(stranger), 'ch_fake')).toEqual({ kind: 'missing' });
    // Invitada sin estar en el canal privado: tampoco se entera.
    expect(await resolveTalkChannelRoute(session(guest), 'ch_r2')).toEqual({ kind: 'missing' });
    await db.prepare("INSERT INTO talk_members (channel_id, user_id, role, joined_at) VALUES ('ch_r2', ?, 'member', ?)").run(guest.id, ts);
    expect(await resolveTalkChannelRoute(session(guest), 'ch_r2')).toEqual({ kind: 'switch', workspaceId: owner.id });
  });

  it('ninguna guarda de layout vuelve a buscar sin filtro de workspace', () => {
    for (const app of ['insights', 'flags', 'dashboards', 'persons']) {
      const layout = readFileSync(join(root, `app/[locale]/app/analytics/${app}/[id]/layout.tsx`), 'utf8');
      expect(layout).toContain('recordProjectId');
      expect(layout).not.toContain('getDb');
    }
    expect(readFileSync(join(root, 'app/[locale]/app/talk/[id]/layout.tsx'), 'utf8')).not.toContain('getDb');
    expect(readFileSync(join(root, 'app/[locale]/app/track/projects/[id]/page.tsx'), 'utf8')).not.toContain('getDb');
  });
});
