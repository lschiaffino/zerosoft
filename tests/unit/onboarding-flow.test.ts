import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  chosenApps,
  cleanApps,
  cleanDraft,
  dismissChecklist,
  getProfile,
  markDesktopDownloaded,
  markDesktopSeen,
  saveDraft,
  saveOnboarding,
  saveSetupProgress,
  suggestedApps,
} from '@/lib/onboarding';
import { getOnboardingState } from '@/lib/onboarding-state';
import { createInvite } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { featuredApps, moreAppsByCategory } from '@/lib/workspace-mode';
import { formatSize, macChipFromArch, macChipFromRenderer, platformFromUa } from '@/lib/desktop-detect';
import { safeReturnPath } from '@/lib/oauth-return';
import { desktopDownloads } from '@/lib/desktop-release';
import { makeUser } from './helpers';

async function freshUser(label: string) {
  const u = await makeUser(label);
  await getDb().prepare("UPDATE users SET onboarded_at = NULL, profile = '{}' WHERE id = ?").run(u.id);
  return u;
}

describe('onboarding: apps, borrador y segundo tramo', () => {
  it('sugiere apps por rol y modo, y limpia lo que llega del navegador', () => {
    expect(suggestedApps('sales', 'team')).toEqual(cleanApps(['crm', 'cal', 'link', 'send', 'docs']));
    expect(suggestedApps('support', 'team')).toEqual(expect.arrayContaining(['chat', 'groups']));
    // En uso personal suma Notes y Cal; sin rol, las destacadas del modo.
    expect(suggestedApps('engineering', 'personal')).toEqual(expect.arrayContaining(['track', 'notes', 'cal']));
    expect(suggestedApps(null, 'personal')).toEqual(cleanApps(featuredApps({ mode: 'personal' }).concat(['notes', 'cal'])));
    expect(suggestedApps('nope', 'team')).toEqual(cleanApps(featuredApps({ mode: 'team' })));
    expect(cleanApps(['crm', 'crm', 'x', 3, 'track'])).toEqual(['track', 'crm']);
    expect(cleanDraft({ step: 'apps', mode: 'team', role: 'hacker', size: '2-10', apps: ['docs', 'zz'], teamName: 'A'.repeat(200), invites: 5 })).toEqual({
      step: 'apps',
      mode: 'team',
      size: '2-10',
      apps: ['docs'],
      teamName: 'A'.repeat(80),
    });
    expect(cleanDraft('junk')).toEqual({});
  });

  it('las apps elegidas arman las destacadas y el resto queda en "Más apps"', () => {
    expect(featuredApps({ mode: 'team', chosen: ['groups', 'crm'] })).toEqual(['groups', 'crm']);
    const more = moreAppsByCategory({ mode: 'team', chosen: ['groups', 'crm'] }).flatMap((g) => g.apps);
    expect(more).not.toContain('crm');
    expect(more).toContain('track');
    expect(featuredApps({ mode: 'team', chosen: [] })).toEqual(featuredApps({ mode: 'team' }));
    expect(chosenApps('{"apps":["docs","nope"]}')).toEqual(['docs']);
    expect(chosenApps('{}')).toBeNull();
    expect(chosenApps('not json')).toBeNull();
  });

  it('guarda el borrador, lo borra al terminar y deja el segundo tramo en "connect"', async () => {
    const u = await freshUser('draft');
    await saveDraft(u.id, { step: 'you', mode: 'personal', name: 'Ana' });
    expect((await getProfile(u.id)).draft).toEqual({ step: 'you', mode: 'personal', name: 'Ana' });
    const profile = await saveOnboarding(u, { mode: 'personal', role: 'engineering', apps: ['docs', 'track', 'bogus'] });
    expect(profile).toMatchObject({ v: 2, apps: ['track', 'docs'], entryApp: 'track', setupStep: 'connect' });
    const saved = await getProfile(u.id);
    expect(saved.draft).toBeUndefined();
    expect(saved.apps).toEqual(['track', 'docs']);
    await saveSetupProgress(u.id, { step: 'desktop', sourceTool: 'linear' });
    expect(await getProfile(u.id)).toMatchObject({ setupStep: 'desktop', sourceTool: 'linear' });
    await saveSetupProgress(u.id, { sourceTool: 'not-a-tool' });
    expect((await getProfile(u.id)).sourceTool).toBeUndefined();
    await saveSetupProgress(u.id, { done: true });
    expect((await getProfile(u.id)).setupDoneAt).toBeTruthy();
  });

  it('el estado sale de los datos: invitar, conectar, importar y escritorio', async () => {
    const u = await freshUser('state');
    await saveOnboarding(u, { mode: 'team', teamName: 'Acme', role: 'sales', apps: ['crm', 'cal', 'groups'] });
    await saveSetupProgress(u.id, { sourceTool: 'hubspot' });
    let s = (await getOnboardingState(u.id))!;
    expect(s.newFlow).toBe(true);
    expect(s.showChecklist).toBe(true);
    expect(s.steps.filter((x) => x.relevant).map((x) => x.key)).toEqual(['profile', 'invite', 'import', 'calendar', 'email', 'whatsapp', 'desktop']);
    expect(s.pending).toEqual(['invite', 'import', 'calendar', 'email', 'whatsapp', 'desktop']);
    expect(s.steps.find((x) => x.key === 'import')?.href).toBe('/app/settings/import?source=crm:hubspot');

    // Hacer clic en "Descargar" no lo marca: solo que la app avise.
    await markDesktopDownloaded(u.id);
    s = (await getOnboardingState(u.id))!;
    expect(s.pending).toContain('desktop');
    expect(s.desktop.downloadedAt).toBeTruthy();
    await markDesktopSeen(u.id, { platform: 'darwin', version: '0.4.0' });
    const firstSeen = (await getProfile(u.id)).desktopSeenAt;
    await markDesktopSeen(u.id, { platform: 'evil<script>', version: 'x y z' });
    const p = await getProfile(u.id);
    expect(p.desktopSeenAt).toBe(firstSeen);
    expect(p).toMatchObject({ desktopPlatform: 'darwin', desktopVersion: '0.4.0' });

    const team = await ensureWorkspace(u.id);
    await createInvite(team.id, `mate-${Date.now()}@test.local`, u.id);
    await getDb()
      .prepare("INSERT INTO integrations (user_id, provider, email) VALUES (?, 'google_calendar', 'a@b.c')")
      .run(u.id);
    s = (await getOnboardingState(u.id))!;
    expect(s.pending).toEqual(['import', 'email', 'whatsapp']);
    expect(s.doneCount).toBe(4);
    expect(s.totalCount).toBe(7);

    // Un miembro (no admin) no ve invitar, importar ni WhatsApp.
    const asMember = (await getOnboardingState(u.id, { admin: false }))!;
    expect(asMember.steps.filter((x) => x.relevant).map((x) => x.key)).toEqual(['profile', 'calendar', 'email', 'desktop']);

    await dismissChecklist(u.id);
    expect((await getOnboardingState(u.id))!.showChecklist).toBe(false);
    await dismissChecklist(u.id, false);
    expect((await getOnboardingState(u.id))!.showChecklist).toBe(true);
  });

  it('quien usaba zerosoft antes (sin perfil v2) no ve "Primeros pasos"', async () => {
    const u = await makeUser('old');
    const s = (await getOnboardingState(u.id))!;
    expect(s.newFlow).toBe(false);
    expect(s.showChecklist).toBe(false);
    expect(await getOnboardingState('nobody-here')).toBeNull();
  });
});

describe('app de escritorio: sistema, chip y release', () => {
  it('sistema por user agent', () => {
    expect(platformFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBe('mac');
    expect(platformFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('mobile');
    expect(platformFromUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win');
    expect(platformFromUa('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
    expect(platformFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('mobile');
    expect(platformFromUa('Mozilla/5.0 (Linux; Android 15)')).toBe('mobile');
  });

  it('chip del Mac por UA-CH y por la GPU de WebGL', () => {
    expect(macChipFromArch('arm')).toBe('mac-arm');
    expect(macChipFromArch('x86')).toBe('mac-intel');
    expect(macChipFromArch('')).toBeNull();
    expect(macChipFromRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)')).toBe('mac-arm');
    expect(macChipFromRenderer('ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)')).toBe('mac-intel');
    expect(macChipFromRenderer('AMD Radeon Pro 5500M OpenGL Engine')).toBe('mac-intel');
    // Safari lo enmascara: no dice nada.
    expect(macChipFromRenderer('Apple GPU')).toBeNull();
    expect(macChipFromRenderer(null)).toBeNull();
  });

  it('tamaño legible y tamaños por instalador', () => {
    expect(formatSize(3_400_000, 'en')).toBe('3.2 MB');
    expect(formatSize(12 * 1024 * 1024, 'es')).toBe('12 MB');
    expect(formatSize(1, 'en')).toBeNull();
    const asset = (name: string, size: number) => ({ name, size, browser_download_url: `https://dl/${name}` });
    const d = desktopDownloads({
      tag_name: 'desktop-v1.0.0',
      draft: false,
      prerelease: false,
      html_url: 'https://gh/r',
      published_at: null,
      assets: [asset('zerosoft-1.0.0-mac-arm64.dmg', 3_000_000), asset('zerosoft-1.0.0-win-x64.exe', 4_000_000)],
    });
    expect(d.sizes).toEqual({ macArm64: 3_000_000, macX64: null, win: 4_000_000 });
  });

  it('la vuelta del OAuth solo acepta rutas propias de la app', () => {
    expect(safeReturnPath('/es/app/welcome')).toBe('/es/app/welcome');
    expect(safeReturnPath('/en/app')).toBe('/en/app');
    expect(safeReturnPath('https://evil.test/en/app/welcome')).toBeNull();
    expect(safeReturnPath('//evil.test/app')).toBeNull();
    expect(safeReturnPath('/en/app/welcome?x=1')).toBeNull();
    expect(safeReturnPath('/fr/app/welcome')).toBeNull();
    expect(safeReturnPath('/en/app/../../x')).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});
