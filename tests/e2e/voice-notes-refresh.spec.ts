import { e2eDb } from './helpers/db';
import { expect, test } from '@playwright/test';

/**
 * Nota mejorada de Voice: un refresco de la reunión (cada pocos segundos) no pisa lo que se está haciendo.
 * Las tildes de los próximos pasos quedan como se dejaron, y si el refresco trae una versión que este editor
 * ya mandó a guardar, lo escrito después sigue en pantalla.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = e2eDb();
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

type Note = { sections: Array<{ points: Array<{ text: string }> }>; actionItems: Array<{ text: string; owner: string; due: string }> };

for (const width of [1280, 390]) {
  test(`Voice: el refresco no pisa tildes ni lo escrito en la nota (${width}px)`, async ({ page }) => {
    const res = await page.request.post('/api/voice/sessions', { data: { title: `Refresh ${uid()}` } });
    const { id } = (await res.json()) as { id: string };
    await page.request.patch(`/api/voice/sessions/${id}`, { data: { myNotes: 'Pricing per seat' } });
    expect((await page.request.post(`/api/voice/sessions/${id}/enhance`, { data: { locale: 'en' } })).ok()).toBe(true);
    // Próximos pasos para tildar (el modelo falso los saca de la transcripción, que acá no hay).
    const row = (await sql('SELECT enhanced FROM voice_notes WHERE session_id = ?', [id]))[0];
    const note = JSON.parse(String(row.enhanced)) as Note;
    note.actionItems = [
      { text: 'Send the contract', owner: '', due: '' },
      { text: 'Book the next call', owner: '', due: '' },
    ];
    await sql('UPDATE voice_notes SET enhanced = ? WHERE session_id = ?', [JSON.stringify(note), id]);
    // La página solo se refresca sola si la reunión figuraba grabando (la API la crea ya cerrada).
    await sql("UPDATE voice_sessions SET status = 'recording', recorder_id = NULL WHERE id = ?", [id]);

    // El primer refresco de la página (a los 1,5 s) queda retenido hasta que se terminó de editar; al soltarlo,
    // el pedido sale en ese momento y trae la versión que el editor ya guardó.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    let reached!: () => void;
    const inFlight = new Promise<void>((r) => (reached = r));
    const url = `**/api/voice/sessions/${id}`;
    await page.route(url, async (route) => {
      if (route.request().method() !== 'GET' || held) return route.fallback();
      held = true;
      reached();
      await gate;
      await route.continue().catch(() => {});
    });

    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'domcontentloaded' });
    const enhanced = page.getByTestId('voice-enhanced');
    await expect(enhanced).toBeVisible({ timeout: 30_000 });
    const boxes = enhanced.locator('.vc-actions-list').getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    await boxes.first().uncheck();
    await expect(boxes.first()).not.toBeChecked();

    // Una edición que llega a guardarse y, después, más texto.
    const point = enhanced.locator('.vc-points li .vc-edit').first();
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/voice/sessions/${id}`) && r.request().method() === 'PATCH');
    await point.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' annual');
    expect((await saved).ok()).toBe(true);
    await page.keyboard.type(' only');

    await inFlight;
    const refreshed = page.waitForResponse((r) => r.url().endsWith(`/api/voice/sessions/${id}`) && r.request().method() === 'GET');
    release();
    expect((await refreshed).ok()).toBe(true);
    await page.unroute(url);

    await expect(point).toHaveText('Pricing per seat annual only');
    await expect(boxes.first()).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    // Y lo último se guarda solo.
    await expect
      .poll(async () => {
        const d = (await (await page.request.get(`/api/voice/sessions/${id}`)).json()) as { enhanced: Note };
        return d.enhanced.sections[0].points[0].text;
      }, { timeout: 10_000 })
      .toBe('Pricing per seat annual only');
  });
}
