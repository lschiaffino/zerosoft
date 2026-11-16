import { e2eDb } from "./helpers/db";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * El selector de "cuándo" (components/ui/WhenPicker) en Inbox y en Lines, en
 * 1280 y en 390: las opciones del momento numeradas 1, 2, 3… sin huecos,
 * elegir una con el mouse o con su número, y "Pick a date and time" con el
 * calendario del mes y la hora escrita o en atajos, con el mouse y solo con
 * el teclado. Esc y el clic afuera cierran; nada se sale de la pantalla.
 * No depende de la hora del día: las opciones se leen de la pantalla.
 * Con WHEN_SHOTS=<carpeta> deja capturas (claro y oscuro).
 */

const uid = () => Math.random().toString(36).slice(2, 8);
const phone = () =>
  `54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const SHOTS = process.env.WHEN_SHOTS;
/** Lo que espera al servidor (guardar, avisar). Local, con `next dev` compilando la ruta la primera vez, tarda. */
const SERVER_MS = 30_000;

async function sql(
  statement: string,
  args: Array<string | number> = [],
): Promise<Array<Record<string, unknown>>> {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args }))
      .rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
  });
  return errors;
}

async function shot(page: Page, name: string, width: number) {
  if (!SHOTS) return;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${width}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function expectNoSideScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

/** Las opciones van numeradas 1, 2, 3… sin huecos, entre 3 y 6, y "Tomorrow morning" está. */
async function expectOptions(dialog: Locator) {
  const opts = dialog.locator(".ui-when-opt[data-preset]");
  const n = await opts.count();
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(6);
  expect(await opts.locator(".kbd").allInnerTexts()).toEqual(
    Array.from({ length: n }, (_, i) => String(i + 1)),
  );
  await expect(dialog.locator('[data-preset="tomorrow"]')).toContainText(
    "Tomorrow morning",
  );
}

/** Cómo se ve en la página una fecha en inglés (la zona es la del navegador). */
const shown = (
  page: Page,
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
) =>
  page.evaluate(
    ([y, m, d, h, min]) =>
      new Date(y, m, d, h, min).toLocaleString("en", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [y, m, d, h, min],
  );

async function linkInbox(
  request: APIRequestContext,
): Promise<{ id: string; secret: string }> {
  await request.post("/api/inbox/whatsapp");
  await expect
    .poll(
      async () =>
        (
          (await (await request.get("/api/inbox/whatsapp")).json()) as {
            state: { status: string };
          }
        ).state.status,
      { timeout: 10_000 },
    )
    .toBe("connected");
  const [row] = await sql(
    "SELECT a.id, a.webhook_secret FROM inbox_accounts a JOIN users u ON u.id = a.owner_id WHERE a.kind = 'whatsapp' AND u.email = 'demo@zerosoft.ai'",
  );
  return { id: String(row.id), secret: String(row.webhook_secret) };
}

async function inboxChat(page: Page, request: APIRequestContext, name: string) {
  const acc = await linkInbox(request);
  const p = phone();
  const res = await request.post(`/api/inbox/webhook/${acc.id}/${acc.secret}`, {
    data: {
      events: [
        {
          type: "message",
          chatId: `${p}@s.whatsapp.net`,
          isGroup: false,
          fromMe: false,
          senderPhone: p,
          senderName: name,
          providerMessageId: `e2e-${uid()}`,
          body: "hola",
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto("/en/app/inbox", { waitUntil: "networkidle" });
  await expect(page.locator(".ib-item", { hasText: name })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .locator(".ib-item", { hasText: name })
    .locator(".ib-row-btn")
    .click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible({
    timeout: 30_000,
  });
}

async function linesNumber(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/groups/numbers", {
    data: { provider: "fake", name: `When ${uid()}` },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/groups/numbers/${id}/connect`, {
    data: { action: "connect" },
  });
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`/api/groups/numbers/${id}/connect`)
          ).json()) as { status: string }
        ).status,
      { timeout: 10_000 },
    )
    .toBe("connected");
  return (
    (await (await request.get(`/api/groups/numbers/${id}`)).json()) as {
      webhookUrl: string;
    }
  ).webhookUrl;
}

async function linesChat(
  page: Page,
  request: APIRequestContext,
  name: string,
  open = true,
) {
  const webhook = await linesNumber(request);
  const p = phone();
  const res = await request.post(new URL(webhook).pathname, {
    data: {
      events: [
        {
          type: "message",
          chatId: `${p}@c.us`,
          isGroup: false,
          fromMe: false,
          senderPhone: p,
          senderName: name,
          providerMessageId: `e2e-${uid()}`,
          body: "buenas",
        },
      ],
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  await page.goto("/en/app/lines/inbox", { waitUntil: "networkidle" });
  if (!open) return;
  await page.locator(".gr-row", { hasText: name }).click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible({
    timeout: 30_000,
  });
}

for (const width of [1280, 390]) {
  test.describe(`a ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 800 } });
    // Dos o tres idas al servidor por test; local, con `next dev`, la primera compila la ruta.
    test.setTimeout(150_000);

    test("Inbox, enviar más tarde: una opción con su número y otra fecha con el calendario y la hora escrita", async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page);
      const name = `Wanda ${uid()}`;
      await inboxChat(page, request, name);
      const thread = page.locator(".ib-wa-thread");
      const field = page.getByRole("textbox", { name: "Message" });
      const dialog = page.getByRole("dialog", { name: "Send later" });

      await field.fill("primero con un número");
      await thread
        .getByRole("button", { name: "Send", exact: true })
        .click({ button: "right" });
      await expect(dialog).toBeVisible();
      await expectOptions(dialog);
      await shot(page, "inbox-1-options", width);
      // El foco arranca en el mensaje (para escribirlo): la opción se elige con el mouse; el número se prueba en Lines.
      await dialog.locator('[data-preset="tomorrow"]').click();
      await expect(dialog).toBeHidden({ timeout: SERVER_MS });
      await expect(thread.getByText("primero con un número")).toBeVisible({
        timeout: SERVER_MS,
      });

      // El 10 del mes que viene a las 9:30 de la noche.
      await field.fill("después a mano");
      await thread
        .getByRole("button", { name: "Send", exact: true })
        .click({ button: "right" });
      await dialog.getByTestId("when-custom").click();
      await expect(dialog.locator('.ui-cal-day[tabindex="0"]')).toBeFocused();
      await dialog.getByRole("button", { name: "Next month" }).click();
      const target = await page.evaluate(() => {
        const n = new Date();
        return [n.getFullYear(), n.getMonth() + 1] as const;
      });
      const ten = new Date(target[0], target[1], 10);
      const key = `${ten.getFullYear()}-${String(ten.getMonth() + 1).padStart(2, "0")}-10`;
      await dialog.locator(`.ui-cal-day[data-day="${key}"]`).click();
      await expect(
        dialog.locator(`.ui-cal-day[data-day="${key}"]`),
      ).toHaveAttribute("aria-pressed", "true");
      await dialog.getByLabel("Time", { exact: true }).fill("9:30pm");
      const expected = await shown(
        page,
        ten.getFullYear(),
        ten.getMonth(),
        10,
        21,
        30,
      );
      await expect(dialog.locator(".ui-when-summary strong")).toHaveText(
        expected,
      );
      await expect(dialog.locator(".ui-when-summary")).toContainText(" time");
      await expectNoSideScroll(page);
      await shot(page, "inbox-2-custom", width);
      await dialog
        .getByRole("button", { name: "Schedule", exact: true })
        .click();
      await expect(dialog).toBeHidden({ timeout: SERVER_MS });
      await expect(
        page.locator(".ib-toast", { hasText: expected }),
      ).toBeVisible({ timeout: SERVER_MS });
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("Lines, enviar más tarde solo con el teclado; Esc y el clic afuera cierran", async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page);
      const name = `Teclado${uid()}`;
      await linesChat(page, request, name);
      const field = page.locator("textarea.wa-input");
      const dialog = page.getByRole("dialog", { name: "Send later" });

      await field.fill("a las nueve de la noche");
      await field.press("Control+Shift+Enter");
      await expect(dialog).toBeVisible();
      await expectOptions(dialog);
      await expect(dialog.locator(".ui-when-opt").first()).toBeFocused();
      // Arriba desde la primera da la vuelta a "Pick a date and time"; Enter abre el calendario con el foco en el día.
      await page.keyboard.press("ArrowUp");
      await expect(dialog.getByTestId("when-custom")).toBeFocused();
      await page.keyboard.press("Enter");
      const day = dialog.locator('.ui-cal-day[aria-pressed="true"]');
      await expect(day).toBeFocused();
      const before = (await day.getAttribute("data-day"))!;
      await page.keyboard.press("ArrowRight");
      await expect(
        dialog.locator('.ui-cal-day[aria-pressed="true"]'),
      ).toBeFocused();
      const after = (await dialog
        .locator('.ui-cal-day[aria-pressed="true"]')
        .getAttribute("data-day"))!;
      expect(Date.parse(after) - Date.parse(before)).toBe(86_400_000);
      // Tab llega a la hora; "21" y Enter programa.
      await page.keyboard.press("Tab");
      await expect(dialog.getByLabel("Time", { exact: true })).toBeFocused();
      await page.keyboard.type("21");
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      const [y, mo, d] = after.split("-").map(Number);
      const item = page
        .getByTestId("lines-scheduled-strip")
        .getByTestId("lines-scheduled-item");
      await expect(item).toHaveCount(1, { timeout: SERVER_MS });
      await expect(
        page.locator(".ui-toast", {
          hasText: await shown(page, y, mo - 1, d, 21, 0),
        }),
      ).toBeVisible({ timeout: SERVER_MS });

      // Esc cierra (también desde el calendario) y el clic afuera también; el texto sigue en el campo.
      await field.fill("otro");
      await page.getByTestId("lines-send-later").click();
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("when-custom").click();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.getByTestId("lines-send-later").click();
      await expect(dialog).toBeVisible();
      await page.mouse.click(5, 5);
      await expect(dialog).toBeHidden();
      await expect(field).toHaveValue("otro");
      await expectNoSideScroll(page);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("Lines, posponer: día del calendario y una hora de los atajos", async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page);
      const name = `Pospone${uid()}`;
      await linesChat(page, request, name, false);
      const row = page.locator(".gr-rows .gr-row", { hasText: name });
      await expect(row).toBeVisible();
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Snooze chat" }).click();
      const dialog = page.getByRole("dialog", { name: "Snooze until" });
      await expect(dialog).toBeVisible();
      await expectOptions(dialog);
      await dialog.getByTestId("when-custom").click();
      // Los días que ya pasaron no se eligen.
      const today = dialog.locator('.ui-cal-day[aria-current="date"]');
      const todayKey = (await today.getAttribute("data-day"))!;
      if (!todayKey.endsWith("-01"))
        await expect(
          dialog.locator(".ui-cal-day:disabled").first(),
        ).toBeVisible();
      await dialog.getByRole("button", { name: "Next month" }).click();
      const first = dialog.locator(".ui-cal-day:not(:disabled)").first();
      const key = (await first.getAttribute("data-day"))!;
      await first.click();
      const one = await page.evaluate(() =>
        new Date(2026, 0, 1, 13).toLocaleTimeString("en", {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
      await dialog.getByRole("button", { name: one, exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: one, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const [y, mo, d] = key.split("-").map(Number);
      await expect(dialog.locator(".ui-when-summary strong")).toHaveText(
        await shown(page, y, mo - 1, d, 13, 0),
      );
      await expectNoSideScroll(page);
      await shot(page, "lines-snooze-custom", width);
      await dialog.getByRole("button", { name: "Snooze", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toHaveCount(0);
      await expect(
        page.locator(".ui-toast", { hasText: "Snoozed until" }),
      ).toBeVisible({ timeout: SERVER_MS });
      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
}
