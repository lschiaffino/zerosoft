import { expect, type Page } from '@playwright/test';

/**
 * El panel de un chat de Lines o Inbox va en pestañas (components/groups/wa/DetailsTabs.tsx): Info, Miembros,
 * Archivos, Notas, Tareas, CRM y AI. Abre la pestaña `id` del panel que está a la vista (sin tocar si ya está elegida).
 */
export async function detailsTab(page: Page, id: 'info' | 'members' | 'media' | 'notes' | 'tasks' | 'crm' | 'ai'): Promise<void> {
  const tab = page.locator(`[role="tab"][data-details-tab="${id}"]:visible`).first();
  await tab.waitFor({ state: 'visible' });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}

/**
 * Abre el panel del chat (con `open`, si todavía no se ve la pestaña) y elige la pestaña `id`. Reintenta hasta
 * que la página hidrata (antes, el botón que abre el panel todavía no hace nada).
 */
export async function ensureDetailsTab(page: Page, id: Parameters<typeof detailsTab>[1], open: () => Promise<unknown>): Promise<void> {
  const tab = page.locator(`[role="tab"][data-details-tab="${id}"]:visible`).first();
  await expect(async () => {
    if (!(await tab.isVisible())) await open();
    await tab.click({ timeout: 3_000 });
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}
