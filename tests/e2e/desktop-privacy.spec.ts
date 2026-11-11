import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ajustes › Privacidad y datos de la app de escritorio (desktop/ui/settings-privacy.ts) en
 * Chromium con el IPC de Tauri simulado: lo que pinta con el estado que manda Rust (permisos,
 * lo guardado, el registro) y lo que le pide (borrar, exportar, las llaves). Los hechos son los de
 * desktop/privacy-facts.json; la lógica nativa tiene sus tests en Rust (src-tauri/src/privacy.rs).
 */

const ROOT = process.cwd();
const UI = path.join(ROOT, 'desktop/ui');
const FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/privacy-facts.json'), 'utf8'));
const STRINGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/strings.json'), 'utf8'));

let html = '';

test.beforeAll(async () => {
  // El IPC de Tauri, reemplazado por lo mínimo: invoke va a window.__TAURI_INTERNALS__.
  const out = await build({
    entryPoints: [path.join(UI, 'settings.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
    plugins: [
      {
        name: 'tauri-stub',
        setup(b) {
          b.onResolve({ filter: /^@tauri-apps\/api\// }, (a) => ({ path: a.path, namespace: 'tauri-stub' }));
          b.onLoad({ filter: /.*/, namespace: 'tauri-stub' }, (a) => ({
            contents: a.path.endsWith('/event')
              ? 'export const listen = (name, cb) => { (window.__listeners ||= {})[name] = cb; return Promise.resolve(() => {}); };'
              : 'export const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);',
            loader: 'js',
          }));
        },
      },
    ],
  });
  html = fs.readFileSync(path.join(UI, 'settings.html'), 'utf8').replace('<script src="settings.js"></script>', () => `<script>${out.outputFiles[0].text}</script>`);
});

const NOW = Date.UTC(2026, 10, 11, 15, 0, 0);

function state(platform: 'darwin' | 'win32') {
  const mac = platform === 'darwin';
  const dir = mac ? '/Users/ana/Library/Application Support/ai.zerosoft.desktop' : 'C:\\Users\\ana\\AppData\\Roaming\\ai.zerosoft.desktop';
  const store = (id: string, p: string, bytes: number, files: number, deletable = false) => ({ id, path: p, exists: bytes > 0, bytes, files, deletable });
  return {
    settings: {
      locale: 'es',
      platform,
      version: '0.3.7',
      server: 'https://zerosoft.ai',
      mode: 'both',
      shortcut: 'Alt+Space',
      shortcuts: [{ id: 'Alt+Space', label: 'Option + Space' }],
      shortcutTaken: false,
      pasteLastShortcut: 'Control + Command + V',
      restoreClipboard: true,
      openAtLogin: false,
      onboarded: true,
      recordingIndicator: true,
      sendAppName: true,
      keepFailedDictations: true,
      allowSystemAudio: true,
      permissions: mac ? { microphone: 'granted', accessibility: 'denied', camera: 'not-determined', screen: 'granted' } : { microphone: 'not-needed', accessibility: 'not-needed', camera: 'not-needed', screen: 'not-needed' },
      accessibilityHint: 'off',
      signature: 'adhoc',
      account: { signedIn: true, email: 'ana@example.com', name: 'Ana', offline: false },
      pending: [],
      lastLatency: null,
      updates: 'auto',
      update: { available: null, checking: false, checkedAt: null, failed: false },
      updateReady: null,
      strings: STRINGS.es,
    },
    privacy: {
      facts: FACTS,
      capturing: null as string | null,
      usage: { microphone: { last: NOW - 60_000, count: 12 }, clipboard: { last: NOW - 50_000, count: 12 } },
      stores: [
        store('settings', `${dir}/settings.json`, 412, 1),
        store('session', `${dir}/session.json`, 1380, 1),
        store('window_state', `${dir}/.window-state.json`, 96, 1),
        store('pending', `${dir}/pending`, 1_254_000, 4, true),
        store('activity', `${dir}/privacy`, 5210, 1, true),
        store('web_data', mac ? '/Users/ana/Library/WebKit/ai.zerosoft.desktop' : 'C:\\Users\\ana\\AppData\\Local\\ai.zerosoft.desktop\\EBWebView', 48_300_000, 212, true),
        ...(mac ? [store('web_cookies', '/Users/ana/Library/HTTPStorages/ai.zerosoft.desktop.binarycookies', 2900, 1), store('web_cache', '/Users/ana/Library/Caches/ai.zerosoft.desktop', 96_000_000, 840)] : []),
        { id: 'autostart', path: '', exists: false, bytes: 0, files: 0, deletable: false },
      ],
      events: [
        { at: NOW - 50_000, kind: 'paste', trigger: 'dictation', result: 'pasted' },
        { at: NOW - 51_000, kind: 'audio_upload', trigger: 'dictation', result: 'ok', durationMs: 4200, bytes: 134_444, host: 'zerosoft.ai', app: 'Slack' },
        { at: NOW - 52_000, kind: 'mic_stop', durationMs: 4200 },
        { at: NOW - 60_000, kind: 'mic_start', trigger: 'shortcut' },
        ...Array.from({ length: 45 }, (_, i) => ({ at: NOW - 3_600_000 - i * 1000, kind: 'update_check', trigger: 'auto', result: 'ok', host: 'zerosoft.ai' })),
      ],
    },
  };
}

type Call = { cmd: string; args: Record<string, unknown> };

async function open(page: Page, opts: { platform?: 'darwin' | 'win32'; width?: number; capturing?: string } = {}) {
  const st = state(opts.platform ?? 'darwin');
  st.privacy.capturing = opts.capturing ?? null;
  await page.setViewportSize({ width: opts.width ?? 860, height: 720 });
  await page.addInitScript(
    ({ st }) => {
      const w = window as unknown as { __calls: Call[]; __TAURI_INTERNALS__: unknown };
      type Call = { cmd: string; args: Record<string, unknown> };
      w.__calls = [];
      let tabs = { suspend: true, suspendMinutes: 30, restore: true, links: 'tab' };
      w.__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown> = {}) => {
          w.__calls.push({ cmd, args });
          if (cmd === 'settings_get') return Promise.resolve(st.settings);
          if (cmd === 'settings_save') {
            Object.assign(st.settings, args.input);
            return Promise.resolve({ ok: true, view: st.settings });
          }
          if (cmd === 'settings_nav') return Promise.resolve({ ok: false, error: 'offline' });
          if (cmd === 'tabs_prefs_get') return Promise.resolve(tabs);
          if (cmd === 'tabs_prefs_save') {
            tabs = { ...tabs, ...(args.input as object) };
            return Promise.resolve(tabs);
          }
          if (cmd === 'privacy') {
            const p = st.privacy;
            if (args.action === 'delete' && args.target === 'all') return Promise.resolve({ ok: true, restart: true });
            if (args.action === 'delete' && args.target === 'activity') {
              p.events = [];
              p.usage = {} as typeof p.usage;
            } else if (args.action === 'delete') {
              const s = p.stores.find((x) => x.id === args.target);
              if (s) Object.assign(s, { exists: false, bytes: 0, files: 0 });
            }
            if (args.action === 'export') return Promise.resolve({ ok: true, file: '/Users/ana/Downloads/zerosoft-activity-1.json', view: p });
            return Promise.resolve({ ok: true, view: p });
          }
          return Promise.resolve(null);
        },
      };
    },
    { st },
  );
  await page.goto('about:blank');
  await page.setContent(html.replace('</head>', '<script>history.replaceState(null, "", "#privacy")</script></head>'));
  // Cada dato de los hechos tiene su fila (los que no existen en este sistema lo dicen).
  await expect(page.locator('#priv-stores li')).toHaveCount(FACTS.stores.length);
  return st;
}

const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as { __calls: Call[] }).__calls.filter((x) => x.cmd === c).map((x) => x.args), cmd);

test.describe('desktop settings: privacy and data', () => {
  test('lists permissions, local data, what is sent and the activity log from the real state', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacidad y datos' })).toBeVisible();
    await expect(page.locator('#tab-privacy')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#priv-now')).toHaveText('Ahora no se está capturando nada.');
    // Permisos: estado real y último uso.
    const mic = page.locator('#priv-permissions li[data-perm="microphone"]');
    await expect(mic).toContainText('Permitido');
    await expect(mic).toContainText('(12 veces)');
    await expect(page.locator('#priv-permissions li[data-perm="accessibility"]')).toContainText('Todavía no se usó');
    await expect(page.locator('#priv-permissions li[data-perm="clipboard"]')).toContainText('No pide permiso del sistema');
    await expect(page.locator('#priv-permissions li')).toHaveCount(FACTS.permissions.length);
    // Lo guardado: ruta, tamaño y borrar solo donde se puede.
    const pending = page.locator('#priv-stores li[data-store="pending"]');
    await expect(pending.locator('.priv-path')).toHaveText('/Users/ana/Library/Application Support/ai.zerosoft.desktop/pending');
    await expect(pending.locator('[data-size]')).toContainText('1,3 MB');
    await expect(pending.locator('[data-size]')).toContainText('4 archivos');
    await expect(pending.getByRole('button', { name: 'Borrar' })).toBeVisible();
    await expect(page.locator('#priv-stores li[data-store="settings"]').getByRole('button', { name: 'Borrar' })).toHaveCount(0);
    await expect(page.locator('#priv-stores li[data-store="autostart"] [data-size]')).toHaveText('Apagado');
    // Qué sale, lo que no hace y el registro.
    await expect(page.locator('#priv-network li')).toHaveCount(FACTS.network.length);
    await expect(page.locator('#priv-network li[data-net="dictation"]')).toContainText('tu servidor (zerosoft.ai)');
    await expect(page.locator('#priv-never li')).toHaveCount(FACTS.never.length);
    await expect(page.locator('#priv-events li')).toHaveCount(40);
    await expect(page.locator('#priv-events li').nth(1)).toContainText('134 KB');
    await expect(page.locator('#priv-events li').nth(1)).toContainText('Slack');
    await page.locator('#priv-show-all').click();
    await expect(page.locator('#priv-events li')).toHaveCount(49);
    // "Leé cómo funciona" abre la página pública; el código, el archivo del repositorio.
    await page.locator('#priv-docs').click();
    await pending.locator('.priv-src button').first().click();
    expect((await calls(page, 'privacy')).filter((c) => c.action === 'open').map((c) => c.target)).toEqual(['docs', 'source:desktop/src-tauri/src/retry.rs']);
  });

  test('shows what is being captured right now', async ({ page }) => {
    await open(page, { capturing: 'traySystemAudio' });
    await expect(page.locator('#priv-now')).toHaveText('Capturando ahora: capturando el audio de la computadora');
  });

  test('switches save right away and deleting asks first', async ({ page }) => {
    await open(page);
    await page.locator('#priv-sendAppName').uncheck();
    await page.locator('#priv-keepFailedDictations').uncheck();
    await page.locator('#priv-restoreTabs').uncheck();
    expect(await calls(page, 'settings_save')).toEqual([{ input: { sendAppName: false } }, { input: { keepFailedDictations: false } }]);
    expect(await calls(page, 'tabs_prefs_save')).toEqual([{ input: { restore: false } }]);
    await expect(page.locator('#priv-sendAppName')).not.toBeChecked();

    // Borrar pide confirmar en el lugar; Cancelar no borra nada.
    const pending = page.locator('#priv-stores li[data-store="pending"]');
    await pending.getByRole('button', { name: 'Borrar' }).click();
    await expect(pending.getByRole('alert')).toBeVisible();
    await pending.getByRole('button', { name: 'Cancelar' }).click();
    expect((await calls(page, 'privacy')).filter((c) => c.action === 'delete')).toEqual([]);
    await pending.getByRole('button', { name: 'Borrar' }).click();
    await pending.getByRole('button', { name: 'Confirmar' }).click();
    await expect(pending.locator('[data-size]')).toHaveText('Nada guardado');
    await expect(pending.getByRole('button', { name: 'Borrar' })).toHaveCount(0);

    // Exportar y vaciar el registro.
    await page.locator('#priv-export').click();
    await expect(page.getByRole('status').first()).toContainText('zerosoft-activity-1.json');
    await page.locator('#priv-log').locator('xpath=..').getByRole('button', { name: 'Vaciar' }).click();
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.locator('#priv-log')).toContainText('Todavía nada.');

    // Borrar todo: también con confirmación.
    await page.locator('#priv-delete-all').getByRole('button').click();
    await expect(page.locator('#priv-delete-all').getByRole('alert')).toContainText('¿Borrar todo lo que zerosoft guardó');
    await page.locator('#priv-delete-all').getByRole('button', { name: 'Confirmar' }).click();
    expect((await calls(page, 'privacy')).filter((c) => c.action === 'delete').map((c) => c.target)).toEqual(['pending', 'activity', 'all']);
  });

  test('on Windows it hides what only exists on Mac, and fits a narrow window', async ({ page }) => {
    await open(page, { platform: 'win32', width: 390 });
    await expect(page.locator('#priv-sendAppName')).toHaveCount(0);
    await expect(page.locator('#priv-allowSystemAudio')).toHaveCount(0);
    await expect(page.locator('#priv-keepFailedDictations')).toBeVisible();
    await expect(page.locator('#priv-stores li[data-store="web_cookies"] [data-size]')).toHaveText('No se usa en este sistema');
    await expect(page.locator('#priv-permissions li[data-perm="microphone"]')).toContainText('No pide permiso del sistema');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(
      await page.evaluate(() => {
        const m = document.getElementById('main')!;
        return m.scrollWidth <= m.clientWidth;
      }),
    ).toBe(true);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`reads well in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, { capturing: scheme === 'dark' ? 'trayMic' : undefined });
      await expect(page.locator('#priv-permissions li[data-perm="microphone"] .perm-title')).toBeVisible();
      if (process.env.ZS_SHOTS) await page.screenshot({ path: `${process.env.ZS_SHOTS}/privacy-${scheme}.png`, fullPage: false });
      if (process.env.ZS_SHOTS) {
        await page.locator('#priv-stores').scrollIntoViewIfNeeded();
        await page.locator('#priv-stores li[data-store="pending"]').getByRole('button', { name: 'Borrar' }).click();
        await page.screenshot({ path: `${process.env.ZS_SHOTS}/privacy-${scheme}-stores.png` });
        await page.locator('#priv-events').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${process.env.ZS_SHOTS}/privacy-${scheme}-log.png` });
      }
    });
  }
});
