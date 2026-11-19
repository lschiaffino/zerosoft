import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Las solapas "WhatsApp | Internal note" sobre el composer de Lines (también la
 * bandeja de equipo): dos solapas de carpeta que sobresalen sobre el fondo del
 * chat, la de WhatsApp verde y la de la nota amarilla. La activa tiene el color
 * del panel de abajo (se pega a él); flechas e Inicio/Fin pasan de una a otra.
 * Con el WhatsApp falso (GROUPS_FAKE=1). Con LINES_TABS_SHOTS=<carpeta> guarda
 * capturas en los cinco aspectos, claro y oscuro, a 1280 y 390.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () => `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function fakeLinesNumber(request: APIRequestContext) {
  const created = await request.post('/api/groups/numbers', { data: { provider: 'fake', name: `Tabs ${uid()}` } });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, { data: { action: 'connect' } });
  await expect
    .poll(async () => ((await (await request.get(`/api/groups/numbers/${id}/connect`)).json()) as { status: string }).status, { timeout: 10_000 })
    .toBe('connected');
  const info = (await (await request.get(`/api/groups/numbers/${id}`)).json()) as { webhookUrl: string };
  return async (list: unknown[]) => {
    const res = await request.post(new URL(info.webhookUrl).pathname, { data: { events: list } });
    expect(res.ok(), await res.text()).toBe(true);
  };
}

/** Colores tal como los pinta el navegador, en 0..255 (rgb(), rgba() o color(srgb ...)). */
type Rgb = [number, number, number];

async function paint(page: Page) {
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number] => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c.startsWith('color(') ? [n[0] * 255, n[1] * 255, n[2] * 255] : [n[0], n[1], n[2]];
    };
    const inbox = document.querySelector('.gr-inbox') as HTMLElement;
    const probe = document.createElement('div');
    inbox.appendChild(probe);
    const token = (name: string) => {
      probe.style.background = `var(${name})`;
      return parse(getComputedStyle(probe).backgroundColor);
    };
    const bg = (sel: string) => parse(getComputedStyle(document.querySelector(sel) as HTMLElement).backgroundColor);
    const out = {
      replySurface: token('--wa-reply-surface'),
      noteSurface: token('--wa-note-surface'),
      composer: bg('.wa-composer'),
      reply: bg('.wa-mode-reply'),
      note: bg('.wa-mode-note'),
      strip: bg('.wa-mode'),
      wall: bg('.wa-messages'),
      replyH: (document.querySelector('.wa-mode-reply') as HTMLElement).getBoundingClientRect().height,
      noteH: (document.querySelector('.wa-mode-note') as HTMLElement).getBoundingClientRect().height,
    };
    probe.remove();
    return out;
  });
}

const near = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
const greenish = ([r, g, b]: Rgb) => g > r + 4 && g > b + 4;
const yellowish = ([r, g, b]: Rgb) => r > b + 12 && g > b + 12;

async function openChat(page: Page, request: APIRequestContext, width: number) {
  const post = await fakeLinesNumber(request);
  const who = `Tabs ${uid()}`;
  const p = phone();
  await post([{ type: 'message', chatId: `${p}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: p, senderName: who, providerMessageId: `e2e-${uid()}`, body: 'Hola, consulta', timestamp: new Date().toISOString() }]);
  await page.setViewportSize({ width, height: width < 600 ? 844 : 800 });
  await page.goto('/en/app/lines/inbox', { waitUntil: 'networkidle' });
  await page.locator('.gr-row', { hasText: who }).click({ timeout: 90_000 });
  await expect(page.locator('.wa-mode')).toBeVisible({ timeout: 90_000 });
}

for (const width of [1280, 390]) {
  test(`Lines: solapas WhatsApp y nota interna sobre el composer (${width})`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await openChat(page, request, width);
    const reply = page.getByRole('tab', { name: 'WhatsApp' });
    const note = page.getByRole('tab', { name: 'Internal note' });
    await expect(reply).toBeVisible();
    await expect(note).toBeVisible();
    await expect(reply).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveAttribute('aria-selected', 'false');

    // Respondiendo: la solapa de WhatsApp es verde y del color del panel; la de la nota, amarilla y más baja.
    let c = await paint(page);
    expect(greenish(c.replySurface), `reply ${c.replySurface}`).toBe(true);
    expect(yellowish(c.noteSurface), `note ${c.noteSurface}`).toBe(true);
    expect(near(c.reply, c.composer), `${c.reply} vs ${c.composer}`).toBe(true);
    expect(near(c.composer, c.replySurface)).toBe(true);
    expect(greenish(c.reply)).toBe(true);
    expect(yellowish(c.note)).toBe(true);
    expect(c.replyH).toBeGreaterThan(c.noteH);
    // Detrás de las solapas se ve el fondo del chat, no una franja gris.
    expect(near(c.strip, c.wall), `${c.strip} vs ${c.wall}`).toBe(true);

    // Con el teclado: flecha a la derecha pasa a la nota, a la izquierda vuelve.
    await reply.focus();
    await page.keyboard.press('ArrowRight');
    await expect(note).toHaveAttribute('aria-selected', 'true');
    await expect(note).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Internal note' })).toBeVisible();
    c = await paint(page);
    expect(near(c.note, c.composer), `${c.note} vs ${c.composer}`).toBe(true);
    expect(near(c.composer, c.noteSurface)).toBe(true);
    expect(yellowish(c.note)).toBe(true);
    expect(greenish(c.reply)).toBe(true);
    expect(c.noteH).toBeGreaterThan(c.replyH);
    await page.keyboard.press('ArrowLeft');
    await expect(reply).toHaveAttribute('aria-selected', 'true');
    await expect(reply).toBeFocused();
    await page.keyboard.press('End');
    await expect(note).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(reply).toHaveAttribute('aria-selected', 'true');
    // Una sola parada de Tab: la solapa activa.
    await expect(reply).toHaveAttribute('tabindex', '0');
    await expect(note).toHaveAttribute('tabindex', '-1');

    // Con el mouse también.
    await note.click();
    await expect(note).toHaveAttribute('aria-selected', 'true');

    // Oscuro: los mismos colores, más oscuros, y la activa sigue pegada al panel.
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    c = await paint(page);
    expect(near(c.note, c.composer)).toBe(true);
    expect(greenish(c.reply), `dark reply ${c.reply}`).toBe(true);
    expect(c.composer.reduce((a, b) => a + b, 0)).toBeLessThan(300);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = await note.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}

for (const width of [1280, 390]) {
  test(`Lines: "Polish" flota sobre el campo y no mueve la conversación (${width})`, async ({ page, request }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await openChat(page, request, width);
    const input = page.getByTestId('composer-input');
    const polish = page.getByTestId('ai-compose-polish');
    const boxes = () =>
      page.evaluate(() => {
        const r = (sel: string) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect();
        return { pane: r('.wa-messages').height, top: r('.wa-composer').top, field: r('.wa-input').height };
      });
    // 14 palabras: todavía no se ofrece pulir. La 15.ª lo ofrece; el campo sigue en un renglón.
    await input.fill(Array.from({ length: 14 }, () => 'a').join(' '));
    await expect(polish).toHaveCount(0);
    const before = await boxes();
    await input.pressSequentially(' z');
    await expect(polish).toBeVisible();
    const after = await boxes();
    expect(after.field).toBe(before.field);
    expect(after.pane).toBe(before.pane);
    expect(after.top).toBe(before.top);
    // El chip flota sobre el borde de arriba del campo, dentro de la pantalla y sin tapar el renglón del texto.
    const chip = (await polish.boundingBox())!;
    const field = (await input.boundingBox())!;
    expect(chip.x).toBeGreaterThanOrEqual(0);
    expect(chip.x + chip.width).toBeLessThanOrEqual(width);
    expect(chip.y).toBeGreaterThanOrEqual(0);
    expect(chip.y + chip.height).toBeLessThanOrEqual(field.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Con el teclado se llega desde el campo; un clic abre la barra.
    await input.focus();
    await page.keyboard.press('Tab');
    await expect(polish.getByRole('button')).toBeFocused();
    await polish.getByRole('button').click();
    await expect(page.getByTestId('ai-compose')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('Lines: capturas de las solapas en los cinco aspectos', async ({ page, request }) => {
  const dir = process.env.LINES_TABS_SHOTS;
  test.skip(!dir, 'solo para la pasada visual (LINES_TABS_SHOTS=<carpeta>)');
  test.setTimeout(300_000);
  for (const width of [1280, 390]) {
    await openChat(page, request, width);
    for (const look of ['current', 'lines', 'classic', 'liquid', 'retro']) {
      for (const theme of ['light', 'dark']) {
        await page.evaluate(([l, t]) => {
          document.documentElement.setAttribute('data-look', l);
          document.documentElement.setAttribute('data-theme', t);
        }, [look, theme]);
        for (const m of ['WhatsApp', 'Internal note']) {
          await page.getByRole('tab', { name: m }).click();
          await page.mouse.move(0, 0);
          const name = `${look}-${theme}-${width}-${m === 'WhatsApp' ? 'reply' : 'note'}`;
          await page.screenshot({ path: `${dir}/${name}.png` });
          const composer = page.locator('.wa-composer');
          const r = (await composer.boundingBox())!;
          await page.screenshot({ path: `${dir}/zoom-${name}.png`, clip: { x: 0, y: Math.max(0, r.y - 80), width: Math.min(width, r.x + r.width), height: Math.min(r.height + 80, 260) } });
        }
        await page.getByRole('tab', { name: 'WhatsApp' }).click();
        await page.getByTestId('composer-input').fill('Hola, te escribo para confirmar que el presupuesto sale mañana a primera hora sin falta.');
        await expect(page.getByTestId('ai-compose-polish')).toBeVisible();
        const box = (await page.locator('.wa-composer').boundingBox())!;
        await page.screenshot({ path: `${dir}/polish-${look}-${theme}-${width}.png`, clip: { x: 0, y: Math.max(0, box.y - 80), width: Math.min(width, box.x + box.width), height: Math.min(box.height + 80, 260) } });
        await page.getByTestId('composer-input').fill('');
      }
    }
  }
});
