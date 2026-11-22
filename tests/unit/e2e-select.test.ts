import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as select from '../../scripts/e2e-select.mjs';

type Plan = {
  mode: 'none' | 'selected' | 'full';
  reason: string;
  specs: string[];
  shards: number;
  areas: string[];
  build: boolean;
  real: boolean;
  quarantine: boolean;
  docker: boolean;
  mac: boolean;
};
const plan = select.plan as (changed: string[], event?: string) => Plan;
const all = select.listSpecs() as string[];
const config = select.loadConfig();
const compiled = select.compileAreas(config);
const name = (f: string) => f.replace(/\.spec\.ts$/, '');
const CORE = ['app-smoke.spec.ts', 'onboarding.spec.ts', 'invite-signup.spec.ts', 'account-security.spec.ts', 'responsive-a.spec.ts'];

describe('qué e2e corre un pull request (scripts/e2e-select.mjs)', () => {
  it('solo CSS de Inbox: los specs de Inbox, los del chat compartido y el grupo core, en pocas partes', () => {
    const p = plan(['styles/inbox.css', 'content/changelog-entries/2026-11-15-inbox.ts']);
    expect(p.mode).toBe('selected');
    for (const s of [...CORE, 'inbox.spec.ts', 'inbox-wa.spec.ts', 'inbox-nav.spec.ts', 'wa-albums.spec.ts']) expect(p.specs).toContain(s);
    expect(p.specs.some((s) => s.startsWith('lines-') || s.startsWith('track-') || s.startsWith('docs'))).toBe(false);
    expect(p.shards).toBeLessThanOrEqual(2);
    expect(p).toMatchObject({ build: true, real: false, quarantine: false, docker: false });
  });

  it('el chat compartido (components/groups/wa, styles/groups-wa.css) corre Inbox y Lines', () => {
    for (const f of ['components/groups/wa/Composer.tsx', 'styles/groups-wa.css', 'lib/wa-albums.ts']) {
      const p = plan([f]);
      expect(p.mode).toBe('selected');
      const expected = all.filter((s) => /^(inbox|wa-|lines-|groups)/.test(s));
      expect(expected.length).toBeGreaterThan(30);
      for (const s of [...expected, ...CORE]) expect(p.specs).toContain(s);
      expect(p.specs.some((s) => s.startsWith('track-'))).toBe(false);
      expect(p.shards).toBeGreaterThanOrEqual(2);
      expect(p.shards).toBeLessThanOrEqual(3);
    }
  });

  it('solo Docs: los specs de Docs y los de Notes, que usa su editor', () => {
    const p = plan(['components/docs/Editor.tsx', 'lib/docs-blocks.ts', 'messages/en/docs.json', 'messages/es/docs.json', 'messages/pt/docs.json']);
    expect(p.mode).toBe('selected');
    for (const s of all.filter((f) => /^(docs|notes-)/.test(f))) expect(p.specs).toContain(s);
    expect(p.specs).not.toContain('board-layout.spec.ts');
    expect(p.specs).not.toContain('track-linear.spec.ts');
  });

  it('código compartido: suite completa, sin los jobs que solo van en main', () => {
    for (const f of [
      'lib/db.ts', 'lib/schema/migrations.ts', 'lib/schema/baseline.ts', 'lib/auth.ts', 'lib/session.ts', 'middleware.ts',
      'components/ui/ConfirmDialog.tsx', 'components/app/AppSidebar.tsx', 'styles/globals.css', 'styles/ui.css',
      'messages/en/common.json', 'package.json', 'package-lock.json', 'playwright.config.ts', 'next.config.mjs',
      'scripts/e2e-shard.mjs', 'tests/e2e/helpers/db.ts',
    ]) {
      const p = plan(['styles/inbox.css', f]);
      expect(p.mode, f).toBe('full');
      expect(p.specs, f).toEqual(all);
      expect(p.shards, f).toBe(6);
    }
    expect(plan(['lib/db.ts'])).toMatchObject({ real: false, quarantine: false, docker: false });
  });

  it('un archivo que no está en el mapa pide la suite completa', () => {
    for (const f of ['lib/utils.ts', 'app/layout.tsx', 'public/logo.svg', 'instrumentation.ts', 'app/api/cron/minute/route.ts', 'scripts/seed.ts']) {
      expect(plan([f]).mode, f).toBe('full');
    }
  });

  it('solo contenido o documentación: ningún e2e, ni build, ni Docker', () => {
    for (const files of [
      ['content/blog/2026-11-15-post.mdx'],
      ['content/changelog-entries/2026-11-15-x.ts', 'content/feature-parity/inbox.ts', 'research/ideas.json'],
      ['docs/voice.md', 'README.md', 'AGENTS.md'],
      ['desktop/src-tauri/src/main.rs'],
      ['desktop-mac/App/WebController.swift', 'desktop-mac/project.yml', '.github/workflows/desktop-mac.yml'],
      ['tests/unit/inbox.test.ts'],
    ]) {
      expect(plan(files), files[0]).toMatchObject({ mode: 'none', specs: [], shards: 0, build: false, real: false, quarantine: false, docker: false });
    }
  });

  it('un cambio en los workflows corre todo, con e2e-real, cuarentena y Docker', () => {
    expect(plan(['.github/workflows/ci.yml'])).toMatchObject({ mode: 'full', shards: 6, build: true, real: true, quarantine: true, docker: true });
    expect(plan(['.github/workflows/security.yml'])).toMatchObject({ mode: 'full', shards: 6 });
  });

  it('la app de Mac en Swift corre (y CI result la espera) solo en un PR que toca lo suyo', () => {
    for (const f of ['desktop-mac/App/AppDelegate.swift', '.github/workflows/desktop-mac.yml', '.github/workflows/ci.yml', 'lib/desktop-bridge.ts', 'desktop/privacy-facts.json']) {
      expect(plan([f]).mac, f).toBe(true);
    }
    // Solo la app de Mac: ningún e2e de la web.
    expect(plan(['desktop-mac/Sources/ZerosoftCore/DeepLink.swift'])).toMatchObject({ mode: 'none', build: false, mac: true });
    for (const f of ['styles/inbox.css', 'lib/db.ts', 'desktop/src-tauri/src/lib.rs', 'components/auth/GoogleButton.tsx', 'docs/desktop-swift.md']) {
      expect(plan([f]).mac, f).toBe(false);
    }
    // Fuera de un PR la corre su propio workflow; sin la lista de archivos, ante la duda, sí.
    for (const event of ['push', 'schedule', 'workflow_dispatch']) expect(plan(['desktop-mac/App/AppDelegate.swift'], event).mac).toBe(false);
    expect(plan([]).mac).toBe(true);
  });

  it('Docker solo con el Dockerfile o las dependencias; e2e-real con sus specs o el código de sesión', () => {
    expect(plan(['Dockerfile'])).toMatchObject({ mode: 'none', docker: true, build: false });
    expect(plan(['package-lock.json'])).toMatchObject({ mode: 'full', docker: true });
    expect(plan(['tests/e2e-real/roles.spec.ts'])).toMatchObject({ mode: 'none', real: true, build: true, docker: false });
    expect(plan(['lib/session.ts'])).toMatchObject({ mode: 'full', real: true });
    expect(plan(['components/auth/LoginForm.tsx'])).toMatchObject({ real: true });
  });

  it('la cuarentena corre cuando cambia su lista o un spec que tiene tests en cuarentena', () => {
    expect(plan(['tests/e2e/quarantine.json'])).toMatchObject({ mode: 'none', quarantine: true, build: true });
    const entries = JSON.parse(fs.readFileSync('tests/e2e/quarantine.json', 'utf8')) as { test: string }[];
    const [spec] = select.quarantinedSpecs(entries) as string[];
    if (spec) expect(plan([`tests/e2e/${spec}`])).toMatchObject({ mode: 'selected', quarantine: true });
    expect(plan(['tests/e2e/forms.spec.ts']).quarantine).toBe(false);
  });

  it('una migración nueva suma el grupo core (app-smoke corre cada app sobre una base vacía) y no la suite completa', () => {
    const only = plan(['lib/schema/migration-files/20261115_0600_fleet.ts']);
    expect(only.mode).toBe('selected');
    expect(only.specs.sort()).toEqual([...CORE].sort());
    const withArea = plan(['lib/schema/migration-files/20261115_1338_send_link_button.ts', 'lib/send/core.ts']);
    expect(withArea.mode).toBe('selected');
    expect(withArea.specs).toContain('send.spec.ts');
    expect(withArea.specs).toContain('app-smoke.spec.ts');
  });

  it('un spec cambiado corre ese spec y el grupo core', () => {
    const p = plan(['tests/e2e/forms.spec.ts']);
    expect(p.mode).toBe('selected');
    expect(p.specs.sort()).toEqual([...CORE, 'forms.spec.ts'].sort());
    expect(plan(['tests/e2e/borrado-que-ya-no-existe.spec.ts']).mode).toBe('none');
  });

  it('fuera de un pull request, o sin la lista de archivos, corre todo', () => {
    for (const event of ['push', 'schedule', 'workflow_dispatch']) {
      expect(plan(['styles/inbox.css'], event)).toMatchObject({ mode: 'full', shards: 6, build: true, real: true, quarantine: true, docker: true });
    }
    expect(plan([])).toMatchObject({ mode: 'full', real: true, quarantine: true, docker: true });
    expect(plan(Array.from({ length: 3000 }, (_, i) => `content/blog/${i}.mdx`)).mode).toBe('full');
  });

  it('cada spec de tests/e2e está en un área, en core o en la lista full-only', () => {
    const orphans = all.filter((s) => !select.areasOfSpec(compiled, s).length && !compiled.core(name(s)) && !compiled.fullOnly(name(s)));
    // Un spec nuevo con un prefijo que no está en scripts/e2e-areas.json: sumalo a su área (o a full-only si cruza varias apps).
    expect(orphans).toEqual([]);
  });

  it('las áreas de "with" existen y cada área tiene algún spec', () => {
    const names = Object.keys(config.areas);
    for (const [area, def] of Object.entries(config.areas) as [string, { with?: string[] }][]) {
      for (const w of def.with ?? []) expect(names, `${area}.with`).toContain(w);
      expect(all.some((s) => select.areasOfSpec(compiled, s).includes(area)), area).toBe(true);
    }
  });

  it('el glob: ** cruza carpetas, * no, y los corchetes son literales', () => {
    const re = (g: string) => select.globToRegExp(g) as RegExp;
    expect(re('**/*.md').test('README.md')).toBe(true);
    expect(re('**/*.md').test('docs/a/b.md')).toBe(true);
    expect(re('lib/db*').test('lib/db-retry.ts')).toBe(true);
    expect(re('lib/db*').test('lib/docs.ts')).toBe(false);
    expect(re('lib/wa-*').test('lib/waitlist.ts')).toBe(false);
    expect(re('app/[locale]/app/inbox/**').test('app/[locale]/app/inbox/page.tsx')).toBe(true);
    expect(re('app/[locale]/app/inbox/**').test('app/l/app/inbox/page.tsx')).toBe(false);
    expect(re('styles/inbox-*.css').test('styles/inbox-wa.css')).toBe(true);
  });
});

describe('partes de una selección (scripts/e2e-shard.mjs con lista)', () => {
  it('reparte solo los specs pedidos, cada uno en una sola parte', () => {
    const p = plan(['components/groups/wa/Composer.tsx']);
    const parts = Array.from({ length: p.shards }, (_, i) =>
      execFileSync('node', ['scripts/e2e-shard.mjs', String(i + 1), String(p.shards)], { encoding: 'utf8', env: { ...process.env, E2E_SPECS: p.specs.join(' ') } })
        .split(' ')
        .filter(Boolean),
    );
    for (const part of parts) expect(part.length).toBeGreaterThan(0);
    expect(parts.flat().sort()).toEqual(p.specs.map((s) => `tests/e2e/${s}`).sort());
  });

  it('falla si ningún spec pedido existe, en vez de dejar la parte vacía', () => {
    expect(() => execFileSync('node', ['scripts/e2e-shard.mjs', '1', '1', 'no-existe.spec.ts'], { stdio: 'pipe' })).toThrow();
  });
});
