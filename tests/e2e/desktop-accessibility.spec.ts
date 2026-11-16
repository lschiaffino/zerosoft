import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test, type Page } from '@playwright/test';

/**
 * Accesibilidad en Ajustes de la app de escritorio (desktop/ui/settings.ts), con el IPC de Tauri
 * simulado como en desktop-privacy.spec.ts. Qué causa muestra y qué ofrece según lo que manda Rust
 * (`accessibilityHint`, src-tauri/src/commands.rs): con la app reemplazada en disco estando
 * abierta ("restart") solo sirve reiniciar, y Restablecer permiso no se ofrece en Primeros pasos
 * porque borraría la entrada buena. La lógica nativa tiene sus tests en Rust.
 */

const ROOT = process.cwd();
const UI = path.join(ROOT, 'desktop/ui');
const STRINGS = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop/strings.json'), 'utf8'));

const ORIGIN = 'http://zs-desktop.test';
const transpiled = (file: string) => ts.transpileModule(fs.readFileSync(path.join(UI, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const FILES: Record<string, string> = {
  '/settings.js': transpiled('settings.ts'),
  '/api': transpiled('api.ts'),
  '/settings-privacy': transpiled('settings-privacy.ts'),
  '/settings-tabs': transpiled('settings-tabs.ts'),
  '/tauri-core.js': 'export const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);',
  '/tauri-event.js': 'export const listen = () => Promise.resolve(() => {});',
  '/tauri-window.js': 'export const getCurrentWindow = () => ({ close: () => Promise.resolve() });',
};
const IMPORT_MAP = JSON.stringify({ imports: { '@tauri-apps/api/core': '/tauri-core.js', '@tauri-apps/api/event': '/tauri-event.js', '@tauri-apps/api/window': '/tauri-window.js' } });
const html = fs
  .readFileSync(path.join(UI, 'settings.html'), 'utf8')
  .replace('<script src="settings.js"></script>', () => `<script type="importmap">${IMPORT_MAP}</script><script type="module" src="/settings.js"></script>`);

type Hint = 'ok' | 'off' | 'adhoc' | 'updated' | 'restart';
type Call = { cmd: string; args: Record<string, unknown> };

function view(hint: Hint) {
  return {
    locale: 'es',
    platform: 'darwin',
    version: '0.3.11',
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
    sendAppName: false,
    keepFailedDictations: true,
    allowSystemAudio: false,
    permissions: { microphone: 'granted', accessibility: hint === 'ok' ? 'granted' : 'denied', camera: 'granted', screen: 'granted' },
    accessibilityHint: hint,
    signature: 'stable',
    account: { signedIn: true, email: 'ana@example.com', name: 'Ana', offline: false },
    pending: [],
    lastLatency: null,
    updates: 'auto',
    update: { available: null, checking: false, checkedAt: null, failed: false },
    updateReady: null,
    strings: STRINGS.es,
  };
}

async function open(page: Page, hint: Hint, tab: 'start' | 'permissions', width = 860) {
  await page.setViewportSize({ width, height: 760 });
  await page.addInitScript(
    ({ v }) => {
      const w = window as unknown as { __calls: Call[]; __TAURI_INTERNALS__: unknown };
      type Call = { cmd: string; args: Record<string, unknown> };
      w.__calls = [];
      w.__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown> = {}) => {
          w.__calls.push({ cmd, args });
          if (cmd === 'settings_get' || cmd === 'permission_ask') return Promise.resolve(v);
          if (cmd === 'settings_nav') return Promise.resolve({ ok: false, error: 'offline' });
          return Promise.resolve(null);
        },
      };
    },
    { v: view(hint) },
  );
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(route.request().url()).pathname;
    if (file === '/') return route.fulfill({ contentType: 'text/html', body: html });
    return file in FILES ? route.fulfill({ contentType: 'text/javascript', body: FILES[file] }) : route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/#${tab}`);
  await expect(page.locator(`#tab-${tab}`)).toHaveAttribute('aria-current', 'page');
}

const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as { __calls: Call[] }).__calls.filter((x) => x.cmd === c).map((x) => x.args), cmd);

test.describe('desktop settings: Accessibility', () => {
  test('replaced while open: first steps offer restart, not reset', async ({ page }) => {
    await open(page, 'restart', 'start');
    await expect(page.locator('#acc-hint')).toHaveAttribute('data-hint', 'restart');
    await expect(page.locator('#acc-reset')).toHaveCount(0);
    await page.locator('#acc-restart').click();
    expect(await calls(page, 'update_restart')).toHaveLength(1);
    expect(await calls(page, 'permission_ask')).toEqual([]);
  });

  test('switch on for another copy: first steps offer reset and the system list', async ({ page }) => {
    await open(page, 'off', 'start');
    await expect(page.locator('#acc-hint')).toHaveAttribute('data-hint', 'off');
    await expect(page.locator('#acc-restart')).toHaveCount(0);
    await page.locator('#acc-reset').click();
    expect(await calls(page, 'permission_ask')).toEqual([{ kind: 'accessibility-reset' }]);
  });

  test('granted: nothing to do', async ({ page }) => {
    await open(page, 'ok', 'start');
    await expect(page.locator('#acc-hint')).toHaveCount(0);
    await expect(page.locator('#acc-reset')).toHaveCount(0);
    await expect(page.locator('#acc-restart')).toHaveCount(0);
  });

  test('permissions tab says to restart when the app was replaced while open', async ({ page }) => {
    await open(page, 'restart', 'permissions');
    await expect(page.locator('#perm-why')).toHaveAttribute('data-hint', 'restart');
    await page.locator('#perm-restart').click();
    expect(await calls(page, 'update_restart')).toHaveLength(1);
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [1280, 390]) {
      test(`restart state reads well in ${scheme} at ${width}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, 'restart', 'start', width);
        await expect(page.locator('#acc-restart')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (process.env.ZS_SHOTS) {
          await page.locator('#acc-restart').scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${process.env.ZS_SHOTS}/acc-start-${scheme}-${width}.png` });
          await page.locator('#tab-permissions').click();
          await expect(page.locator('#perm-restart')).toBeVisible();
          await page.screenshot({ path: `${process.env.ZS_SHOTS}/acc-perms-${scheme}-${width}.png` });
        }
      });
    }
  }
});
