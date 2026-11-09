import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, test, type Page } from '@playwright/test';

/**
 * Tira de pestañas de la app de escritorio (desktop/ui/tabs.ts) en Chromium con el IPC de Tauri
 * simulado: lo que dibuja con el estado que manda Rust y lo que le pide (tabs_action) con mouse y
 * teclado. La lógica de ventanas y pestañas tiene sus tests en Rust (src-tauri/src/session.rs).
 */

const UI = path.join(process.cwd(), 'desktop/ui');
// tabs.ts no importa nada: se transpila y va en línea como módulo.
const js = ts.transpileModule(fs.readFileSync(path.join(UI, 'tabs.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
const html = fs.readFileSync(path.join(UI, 'tabs.html'), 'utf8').replace('<script src="tabs.js"></script>', () => `<script type="module">${js}</script>`);

interface Tab {
  id: number;
  title: string;
  path: string;
  product: string;
  loaded: boolean;
  unread: boolean;
  recording: boolean;
}

const tab = (id: number, product: string, title = '', extra: Partial<Tab> = {}): Tab => ({ id, title, path: `/app/${product}`, product, loaded: true, unread: false, recording: false, ...extra });

const TABS = [
  tab(1, 'track', 'Overview'),
  tab(2, 'crm', 'Deals · CRM · zerosoft', { unread: true }),
  tab(3, 'talk', '', { recording: true }),
  tab(4, 'docs', 'Plan de lanzamiento del trimestre con un nombre largo de verdad', { loaded: false }),
  tab(5, '', ''),
];

const STRINGS = { newTab: 'Pestaña nueva', closeTab: 'Cerrar pestaña', tabSuspended: 'En pausa', tabRecording: 'Grabando', tabUnread: 'Hay novedades', tabsLabel: 'Pestañas', tabNewTitle: 'Pestaña nueva' };

async function open(page: Page, opts: { tabs?: Tab[]; platform?: 'darwin' | 'win32'; width?: number } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1000, height: 38 });
  await page.addInitScript(
    ({ init }) => {
      const w = window as unknown as { __calls: Array<{ cmd: string; args: Record<string, unknown> }>; __TAURI_INTERNALS__: unknown };
      w.__calls = [];
      w.__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          w.__calls.push({ cmd, args });
          return Promise.resolve(cmd === 'tabs_ready' ? init : null);
        },
      };
    },
    { init: { platform: opts.platform ?? 'darwin', locale: 'es', strings: STRINGS, view: { active: 1, fullscreen: false, tabs: opts.tabs ?? TABS } } },
  );
  await page.goto('about:blank');
  await page.setContent(html);
  await expect(page.getByRole('tab')).toHaveCount((opts.tabs ?? TABS).length);
}

const actions = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Array<{ cmd: string; args: Record<string, unknown> }> }).__calls.filter((c) => c.cmd === 'tabs_action').map((c) => c.args));

test.describe('desktop tab strip', () => {
  test('shows each tab with its product, title and state', async ({ page }) => {
    await open(page);
    const tabs = page.getByRole('tab');
    await expect(page.getByRole('tablist', { name: 'Pestañas' })).toBeVisible();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toContainText('Overview');
    // El sufijo del sitio se va; sin título, el nombre del producto; sin producto, "Pestaña nueva".
    await expect(tabs.nth(1).locator('.title')).toHaveText('Deals · CRM');
    await expect(tabs.nth(2).locator('.title')).toHaveText('Talk');
    await expect(tabs.nth(4).locator('.title')).toHaveText('Pestaña nueva');
    await expect(tabs.nth(1).locator('.badge')).toHaveCount(1);
    await expect(tabs.nth(1)).toHaveAttribute('aria-label', /Hay novedades/);
    await expect(tabs.nth(2).locator('.rec')).toHaveCount(1);
    await expect(tabs.nth(3)).toHaveClass(/asleep/);
    await expect(tabs.nth(3)).toHaveAttribute('title', /En pausa/);
    await expect(page.getByRole('button', { name: 'Pestaña nueva' })).toBeVisible();
    // Mac: lugar para los semáforos.
    const left = await tabs.nth(0).evaluate((el) => el.getBoundingClientRect().left);
    expect(left).toBeGreaterThanOrEqual(78);
  });

  test('click, close, middle click, new tab and context menu ask Rust', async ({ page }) => {
    await open(page);
    const tabs = page.getByRole('tab');
    await tabs.nth(1).click();
    await tabs.nth(0).hover();
    await tabs.nth(0).getByRole('button', { name: 'Cerrar pestaña' }).click();
    await tabs.nth(2).click({ button: 'middle' });
    await page.getByRole('button', { name: 'Pestaña nueva' }).click();
    await tabs.nth(3).click({ button: 'right' });
    expect(await actions(page)).toEqual([
      { action: 'activate', id: 2 },
      { action: 'close', id: 1 },
      { action: 'close', id: 3 },
      { action: 'new' },
      { action: 'menu', id: 4 },
    ]);
  });

  test('keyboard: arrows move focus, Enter opens, Delete closes', async ({ page }) => {
    await open(page);
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab').nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab').nth(4)).toBeFocused();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Shift+F10');
    expect(await actions(page)).toEqual([
      { action: 'activate', id: 2 },
      { action: 'close', id: 5 },
      { action: 'menu', id: 5 },
    ]);
    // Foco visible.
    const ring = await page.getByRole('tab').nth(4).evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe('none');
  });

  test('drag reorders in place and dragging out asks for its own window', async ({ page }) => {
    await open(page, { tabs: TABS.slice(0, 3) });
    const box = async (i: number) => (await page.getByRole('tab').nth(i).boundingBox())!;
    const a = await box(0);
    const c = await box(2);
    await page.mouse.move(a.x + 30, a.y + 15);
    await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 15, { steps: 3 });
    await page.mouse.move(c.x + c.width - 10, a.y + 15, { steps: 6 });
    await page.mouse.up();
    // Al toque en pantalla y avisado a Rust.
    await expect(page.getByRole('tab').last()).toContainText('Overview');
    expect((await actions(page)).at(-1)).toEqual({ action: 'move', id: 1, index: 2 });

    const b = await box(0);
    await page.mouse.move(b.x + 30, b.y + 15);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y + 80, { steps: 4 });
    await page.mouse.move(b.x + 60, b.y + 160, { steps: 4 });
    await page.mouse.up();
    const last = (await actions(page)).at(-1)!;
    expect(last.action).toBe('drop');
    expect(typeof last.x).toBe('number');
    expect(typeof last.y).toBe('number');
  });

  test('updates from Rust keep the same elements and many tabs never scroll sideways', async ({ page }) => {
    const many = Array.from({ length: 14 }, (_, i) => tab(i + 1, ['track', 'crm', 'docs', 'talk', 'notes', 'calendar', 'links'][i % 7], `Registro ${i + 1}`));
    await open(page, { tabs: many, width: 760, platform: 'win32' });
    const first = await page.getByRole('tab').first().elementHandle();
    await page.evaluate((tabs) => (window as unknown as { __zsTabs: { render: (v: unknown) => void } }).__zsTabs.render({ active: 2, fullscreen: false, tabs: tabs.map((t, i) => (i === 0 ? { ...t, title: 'Cambiado' } : t)) }), many);
    await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    expect(await first!.evaluate((el) => el.isConnected && el.textContent?.includes('Cambiado'))).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('.tab.narrow').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pestaña nueva' })).toBeInViewport();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`reads well in ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      const [fg, bg] = await page.getByRole('tab').first().evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
      expect(fg).not.toBe(bg);
      const dir = process.env.DESKTOP_TABS_SHOTS;
      if (dir) await page.screenshot({ path: path.join(dir, `strip-${scheme}.png`) });
    });
  }
});
