import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_KEYS, type ProductKey } from '@/lib/products';
import { SETTINGS_SECTION_KEYS, settingsSectionHref } from '@/lib/settings-nav';
import { anchorOf, settingsRegistry, settingVisible, type MsgRef, type SettingDef, type SettingsViewer } from '@/lib/settings-registry';
import { buildSettingsIndex, plainMessage, rawMessage, registryFiles, SETTINGS_LOCALES, type MessagesByLocale } from '@/lib/settings-search-index';
import { anchorFromHash, editDistance, fold, groupHits, searchSettings, settingHref, type SettingsSearchItem } from '@/lib/settings-search';

const ROOT = process.cwd();
const defs = settingsRegistry();

function loadMessages(): MessagesByLocale {
  const out = { en: {}, es: {}, pt: {} } as MessagesByLocale;
  for (const locale of SETTINGS_LOCALES)
    for (const file of registryFiles(defs)) out[locale][file] = JSON.parse(readFileSync(path.join(ROOT, 'messages', locale, `${file}.json`), 'utf8'));
  return out;
}
const messages = loadMessages();

const everyone: SettingsViewer = { role: 'owner', admin: true, staff: true, canUse: () => true };
const index = (locale: 'en' | 'es' | 'pt' = 'en', viewer: SettingsViewer = everyone) =>
  buildSettingsIndex(
    defs.filter((d) => settingVisible(d, viewer)),
    { locale, messages, workspace: 'Acme' },
  );
const ids = (items: SettingsSearchItem[], q: string, n = 5) => searchSettings(items, q, n).map((h) => h.item.id);

describe('matcher', () => {
  const en = index('en');
  const es = index('es');

  it('fold quita tildes y mayúsculas; distancia de edición con transposiciones', () => {
    expect(fold('Contraseña ÁREA')).toBe('contrasena area');
    expect(editDistance('apariencia', 'apariencai')).toBe(1);
    expect(editDistance('theme', 'theme')).toBe(0);
    expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  });

  it('sinónimos: modo oscuro, dark mode y tema llevan al tema de Apariencia', () => {
    expect(ids(en, 'dark mode')[0]).toBe('appearance-theme');
    expect(ids(es, 'oscuro')[0]).toBe('appearance-theme');
    expect(ids(es, 'tema')[0]).toBe('appearance-theme');
    // Palabras de otro idioma también encuentran (con la interfaz en inglés, "oscuro").
    expect(ids(en, 'oscuro')[0]).toBe('appearance-theme');
  });

  it('tildes y mayúsculas no importan', () => {
    expect(ids(es, 'CONTRASENA')[0]).toBe('security-mfa');
    expect(ids(es, 'contraseña')[0]).toBe('security-mfa');
    expect(ids(en, '2fa')[0]).toBe('security-mfa');
  });

  it('errores de tipeo chicos: una letra cambiada o dos invertidas', () => {
    expect(ids(en, 'appearence')).toContain('section-appearance');
    expect(ids(es, 'apariencai')).toContain('section-appearance');
    expect(ids(en, 'webhoks')).toContain('api-webhooks');
    // Palabras cortas no toleran errores: "zz" no encuentra nada.
    expect(ids(en, 'zz')).toEqual([]);
  });

  it('prefijos y varias palabras', () => {
    expect(ids(en, 'webh')[0]).toBe('api-webhooks');
    expect(ids(es, 'mantener archiv')[0]).toBe('lines-keep-archived');
    expect(ids(en, 'keep archived')[0]).toBe('lines-keep-archived');
  });

  it('el título pesa más que las palabras clave y éstas más que la descripción', () => {
    const items: SettingsSearchItem[] = ['title', 'kw', 'desc'].map((where) => ({
      id: where,
      href: '/x',
      anchor: where,
      title: where === 'title' ? 'Webhooks' : 'Other',
      crumbs: [],
      area: 'platform',
      areaLabel: 'Settings',
      terms: { title: where === 'title' ? 'webhooks' : 'other', titleOther: [], kw: where === 'kw' ? 'webhooks' : '', kwOther: '', desc: where === 'desc' ? 'webhooks' : '', crumbs: '' },
    }));
    expect(searchSettings(items.slice().reverse(), 'webhooks').map((h) => h.item.id)).toEqual(['title', 'kw', 'desc']);
  });

  it('el idioma de la persona va primero: su título le gana a una palabra de otro idioma', () => {
    const items: SettingsSearchItem[] = [
      { id: 'other', href: '/x', anchor: null, title: 'B', crumbs: [], area: 'platform', areaLabel: '', terms: { title: 'b', titleOther: ['idioma'], kw: '', kwOther: '', desc: '', crumbs: '' } },
      { id: 'mine', href: '/x', anchor: null, title: 'Idioma', crumbs: [], area: 'platform', areaLabel: '', terms: { title: 'idioma', titleOther: [], kw: '', kwOther: '', desc: '', crumbs: '' } },
    ];
    expect(searchSettings(items, 'idioma').map((h) => h.item.id)).toEqual(['mine', 'other']);
  });

  it('agrupa por área en el orden del mejor resultado, con migas', () => {
    const groups = groupHits(searchSettings(en, 'archived'));
    expect(groups[0].area).toBe('groups');
    const hit = groups[0].hits[0].item;
    expect(hit.crumbs).toEqual(['Lines', 'Settings', 'Tickets and SLA']);
    expect(hit.title).toBe('Keep archived chats archived when a new message arrives');
  });

  it('hash del ajuste: ida y vuelta, y nada raro', () => {
    expect(settingHref('/app/settings/appearance', 'appearance-theme')).toBe('/app/settings/appearance#setting-appearance-theme');
    expect(settingHref('/app/settings', null)).toBe('/app/settings');
    expect(anchorFromHash('#setting-appearance-theme')).toBe('appearance-theme');
    expect(anchorFromHash('#setting-"><img')).toBeNull();
    expect(anchorFromHash('#webhooks')).toBeNull();
  });

  it('ICU: parámetros, plurales y etiquetas', () => {
    expect(plainMessage('Members ({count})')).toBe('Members');
    expect(plainMessage('Invite people to {workspace}', { workspace: 'Acme' })).toBe('Invite people to Acme');
    expect(plainMessage('{n, plural, one {# change} other {# changes}} waiting')).toBe('changes waiting');
    expect(plainMessage('Header <code>Bearer</code> key')).toBe('Header Bearer key');
  });
});

describe('rol y apps', () => {
  const member: SettingsViewer = { role: 'member', admin: false, staff: false, canUse: () => true };
  const guest: SettingsViewer = { role: 'guest', admin: false, staff: false, canUse: (app: ProductKey) => app === 'docs' };

  it('un member no ve lo de admins, owner ni staff', () => {
    const list = index('en', member).map((i) => i.id);
    expect(list).toContain('appearance-theme');
    expect(list).toContain('members-list');
    for (const id of ['members-invite', 'security-workspace', 'workspace-danger', 'admin-feedback', 'lines-tab-access', 'crm-export']) expect(list).not.toContain(id);
    expect(ids(index('en', member), 'invite')).not.toContain('members-invite');
    expect(ids(index('en', everyone), 'invite')).toContain('members-invite');
  });

  it('solo las apps que la persona tiene; member pide no ser invitado', () => {
    const list = index('en', guest).map((i) => i.id);
    expect(list).toContain('product-docs');
    expect(list).not.toContain('product-crm');
    expect(list.some((id) => id.startsWith('lines-'))).toBe(false);
    expect(list).not.toContain('profile-chat-access');
  });

  it('owner ve la zona de peligro; staff, Admin', () => {
    const owner = index('en', { role: 'owner', admin: true, staff: false, canUse: () => true }).map((i) => i.id);
    expect(owner).toContain('workspace-danger');
    expect(owner).not.toContain('admin-feedback');
    const admin = index('en', { role: 'admin', admin: true, staff: false, canUse: () => true }).map((i) => i.id);
    expect(admin).not.toContain('workspace-danger');
    expect(admin).toContain('members-invite');
  });
});

// ---------- Integridad del registro ----------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Anclas en el código: `setting="…"` (FormSection) o `data-setting="…"`. */
function sourceAnchors(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'components'))]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\b(?:data-)?setting="([a-z0-9-]+)"/g)) found.set(m[1], [...(found.get(m[1]) ?? []), path.relative(ROOT, file)]);
  }
  return found;
}

/** Si una ruta de la app (/app/lines/settings) tiene página: carpetas, grupos (x) y catch-alls. */
function routeExists(href: string): boolean {
  const segments = href.split(/[?#]/)[0].split('/').filter(Boolean);
  const resolve = (dir: string, rest: string[]): boolean => {
    const entries = existsSync(dir) ? readdirSync(dir) : [];
    if (!rest.length) return entries.includes('page.tsx') || entries.some((e) => e.startsWith('(') && resolve(path.join(dir, e), [])) || entries.some((e) => e.startsWith('[[...') && resolve(path.join(dir, e), []));
    const [head, ...tail] = rest;
    if (entries.includes(head) && resolve(path.join(dir, head), tail)) return true;
    if (entries.some((e) => e.startsWith('(') && resolve(path.join(dir, e), rest))) return true;
    const catchAll = entries.find((e) => e.startsWith('[[...') || e.startsWith('[...'));
    return Boolean(catchAll && existsSync(path.join(dir, catchAll, 'page.tsx')));
  };
  return resolve(path.join(ROOT, 'app', '[locale]'), segments);
}

describe('registro', () => {
  it('ids únicos', () => {
    const seen = new Set<string>();
    for (const d of defs) {
      expect(seen.has(d.id), d.id).toBe(false);
      seen.add(d.id);
    }
  });

  it('cada ancla del registro existe en el código, y cada ancla del código está en el registro', () => {
    const found = sourceAnchors();
    const wanted = new Set(defs.map(anchorOf).filter((a): a is string => Boolean(a)));
    for (const a of wanted) expect(found.has(a), `falta setting="${a}" en app/ o components/`).toBe(true);
    for (const [a, files] of found) expect(wanted.has(a), `${a} (${files.join(', ')}) no está en lib/settings-registry.ts`).toBe(true);
  });

  it('cada texto existe en en, es y pt', () => {
    for (const d of defs)
      for (const ref of [d.title, d.desc, d.page, d.kwRef].filter(Boolean) as MsgRef[])
        for (const locale of SETTINGS_LOCALES) expect(rawMessage(messages[locale], ref), `${locale} ${ref} (${d.id})`).toBeTypeOf('string');
  });

  it('cada ruta tiene página y las pestañas apuntan a /app', () => {
    for (const d of defs) {
      expect(d.href.startsWith('/app/'), d.id).toBe(true);
      expect(routeExists(d.href), `${d.id}: ${d.href}`).toBe(true);
    }
  });

  it('cada sección de Ajustes y cada app tienen entradas', () => {
    for (const key of SETTINGS_SECTION_KEYS) expect(defs.some((d) => d.href === settingsSectionHref(key)), key).toBe(true);
    for (const key of PRODUCT_KEYS) expect(defs.some((d) => d.area === key || d.app === key), key).toBe(true);
  });

  it('cada entrada tiene título en los tres idiomas y un sinónimo en cada idioma cuando los trae', () => {
    for (const locale of SETTINGS_LOCALES) {
      const items = buildSettingsIndex(defs, { locale, messages, workspace: 'Acme' });
      // Solo se cae una página que se llama igual que un ajuste suyo (Perfil).
      expect(items.length).toBeGreaterThan(defs.length - 5);
      expect(items.map((i) => i.id)).not.toContain('section-profile');
      for (const i of items) expect(i.title.length, `${locale} ${i.id}`).toBeGreaterThan(0);
    }
    for (const d of defs as SettingDef[]) if (d.kw) for (const locale of SETTINGS_LOCALES) expect(d.kw[locale], `${d.id} kw.${locale}`).toBeTruthy();
  });
});
