import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_PRIVACY as F, factsLocale, sourceUrl } from '@/lib/desktop-privacy';

/**
 * desktop/privacy-facts.json es la única lista de lo que la app de escritorio lee, guarda y
 * manda: la usan la página /download/privacy y Ajustes › Privacidad y datos de la app. Acá se
 * revisa su forma y que nombre lo mismo que el código de la app (los tests de Rust de
 * desktop/src-tauri/src/privacy.rs comparan además los límites y las etiquetas).
 */
const root = join(__dirname, '..', '..');
const rust = (file: string) => readFileSync(join(root, 'desktop', 'src-tauri', 'src', file), 'utf8');
const LOCALES = ['en', 'es', 'pt'] as const;
const SECTIONS = ['permissions', 'stores', 'network', 'never', 'indicators', 'events', 'controls', 'security', 'open'] as const;

function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(texts);
  return [];
}

describe('hechos de privacidad del escritorio', () => {
  it('cada hecho está en los tres idiomas, con texto y con su archivo de código', () => {
    for (const section of SECTIONS) {
      const ids = new Set<string>();
      for (const item of F[section]) {
        expect(ids.has(item.id), `${section}.${item.id} repetido`).toBe(false);
        ids.add(item.id);
        expect(item.code.length, `${section}.${item.id}: sin código`).toBeGreaterThan(0);
        for (const file of item.code) expect(existsSync(join(root, file)), `${section}.${item.id}: ${file}`).toBe(true);
        const shape = JSON.stringify(Object.keys(item.en as object).sort());
        for (const l of LOCALES) {
          const all = texts(item[l]);
          expect(all.length, `${section}.${item.id}.${l}`).toBeGreaterThan(0);
          for (const t of all) expect(t.trim().length, `${section}.${item.id}.${l}`).toBeGreaterThan(2);
          if (typeof item.en === 'object') expect(JSON.stringify(Object.keys(item[l] as object).sort()), `${section}.${item.id}.${l}`).toBe(shape);
        }
      }
    }
    for (const l of LOCALES) expect(Object.keys(F.page[l]).sort()).toEqual(Object.keys(F.page.en).sort());
    for (const [tag, t] of Object.entries(F.tags)) for (const l of LOCALES) expect(t[l], `tags.${tag}.${l}`).toBeTruthy();
  });

  it('sigue las reglas de copy: sin guion largo ni frases de marketing', () => {
    const banned = [/—/, /take[s]? (your )?privacy seriously/i, /nos tomamos .* en serio/i, /levamos .* a sério/i, /military[- ]grade/i, /bank[- ]level/i, /100% (secure|seguro)/i];
    for (const t of texts(JSON.parse(readFileSync(join(root, 'desktop', 'privacy-facts.json'), 'utf8')))) {
      for (const re of banned) expect(re.test(t), `${re}: ${t.slice(0, 80)}`).toBe(false);
    }
  });

  it('nombra lo mismo que el código de la app', () => {
    const privacy = rust('privacy.rs');
    const list = (name: string) => new RegExp(`${name}: \\[&str; \\d+\\] = \\[([^\\]]+)\\]`).exec(privacy)?.[1].match(/"([a-z_]+)"/g)?.map((x) => x.slice(1, -1));
    // Lo guardado en disco: los mismos ids, en el mismo orden, que el inventario de la app.
    expect(F.stores.map((s) => s.id)).toEqual(list('STORE_IDS'));
    expect(F.stores.filter((s) => s.delete).map((s) => s.id)).toEqual(list('DELETABLE'));
    // Los eventos del registro: las variantes de `Kind`.
    const kinds = /pub enum Kind \{([\s\S]*?)\n\}/.exec(privacy)?.[1].match(/^\s{4}([A-Z][A-Za-z]+),/gm)?.map((v) => v.trim().slice(0, -1).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
    expect(F.events.map((e) => e.id)).toEqual(kinds);
    // Los permisos con "último uso".
    for (const cap of list('CAPABILITIES') ?? ['?']) expect(F.permissions.map((p) => p.id)).toContain(cap);
    // Cada llave es un ajuste que la app lee de verdad.
    const config = rust('config.rs');
    for (const c of F.controls) {
      if (c.id === 'restoreTabs') expect(rust('session.rs')).toContain('raw.get("restore")');
      else if (c.id === 'openAtLogin') expect(rust('commands.rs')).toContain('input.get("openAtLogin")');
      else expect(config, c.id).toContain(`input.get("${c.id}")`);
    }
    // Los valores por defecto que se dicen son los del código.
    for (const c of F.controls.filter((x) => !['restoreTabs', 'openAtLogin'].includes(x.id))) {
      expect(config, c.id).toContain(`raw.get("${c.id}").and_then(Value::as_bool) != Some(false)`);
      expect(c.default, c.id).toBe(true);
    }
    // La página que abre la app es esta.
    expect(privacy).toContain(`DOCS_PATH: &str = "${F.path}"`);
    expect(existsSync(join(root, 'app', '[locale]', ...F.path.split('/').filter(Boolean), 'page.tsx'))).toBe(true);
  });

  it('los números que se dicen son los del código', () => {
    const remote = JSON.parse(readFileSync(join(root, 'desktop', 'src-tauri', 'capabilities', 'remote.json'), 'utf8')) as { permissions: string[] };
    const bridge = F.security.find((s) => s.id === 'bridge')!;
    for (const l of LOCALES) expect(bridge[l]).toContain(String(remote.permissions.length));
    expect(rust('privacy.rs')).toContain(`MAX_EVENTS: usize = ${F.limits.activityEvents}`);
    expect(rust('privacy.rs')).toContain(`MAX_AGE_MS: u64 = ${F.limits.activityDays} * 86_400_000`);
    expect(rust('retry.rs')).toContain(`PENDING_MAX: usize = ${F.limits.pendingMax}`);
    expect(rust('retry.rs')).toContain(`PENDING_MAX_AGE_MS: u64 = ${F.limits.pendingDays} * 86_400_000`);
    expect(rust('badge.rs')).toContain(`POLL_SECS: u64 = ${F.limits.badgeSeconds}`);
    expect(rust('updater.rs')).toContain(`CHECK_EVERY_SECS: u64 = ${F.limits.updateHours} * 3600`);
    expect(rust('system_audio.rs')).toContain(`IDLE_STOP_MS: u64 = ${F.limits.systemAudioIdleSeconds}_000`);
    // Y los textos usan esos números.
    const store = (id: string) => F.stores.find((s) => s.id === id)!;
    expect(store('pending').en.kept).toContain(`${F.limits.pendingMax}`);
    expect(store('pending').en.kept).toContain(`${F.limits.pendingDays} days`);
    expect(store('activity').en.kept).toContain(`${F.limits.activityEvents} events`);
    expect(F.network.find((n) => n.id === 'badge')!.en.when).toContain(`${F.limits.badgeSeconds} seconds`);
    expect(F.network.find((n) => n.id === 'updates')!.en.when).toContain(`${F.limits.updateHours} hours`);
    expect(F.permissions.find((p) => p.id === 'clipboard')!.en.why).toContain(`${F.limits.clipboardRestoreMs} ms`);
  });

  it('la página de descarga y la app enlazan a la página pública', () => {
    expect(readFileSync(join(root, 'app', '[locale]', 'download', 'page.tsx'), 'utf8')).toContain(`href="${F.path}"`);
    expect(sourceUrl('desktop/src-tauri/src/privacy.rs')).toBe('https://github.com/lschiaffino/zerosoft/blob/main/desktop/src-tauri/src/privacy.rs');
    expect(factsLocale('es')).toBe('es');
    expect(factsLocale('fr')).toBe('en');
    const strings = JSON.parse(readFileSync(join(root, 'desktop', 'strings.json'), 'utf8'));
    for (const l of LOCALES) expect(strings[l].privReadMore).toBeTruthy();
  });
});
