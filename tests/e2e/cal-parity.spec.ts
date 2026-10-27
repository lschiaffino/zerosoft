import { expect, test, type APIRequestContext } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));

async function eventType(request: APIRequestContext, extra: Record<string, unknown> = {}) {
  const res = await request.post('/api/calendar/event-types', {
    data: { slug: `par-${uid()}`, title: `Parity ${uid()}`, durationMin: 30, active: true, ...extra },
  });
  expect(res.status()).toBe(201);
  const et = (await res.json()) as { id: string; slug: string; title: string };
  await request.post(`/api/calendar/event-types/${et.id}/availability`, { data: { rules: ALL_DAYS } });
  return et;
}

async function handle(request: APIRequestContext): Promise<string> {
  return ((await (await request.get('/api/calendar/config')).json()) as { handle: string }).handle;
}

test('Cal: un tipo de evento secreto se reserva por link pero no sale en el perfil', async ({ page, request }) => {
  const et = await eventType(request, { hidden: true });
  const h = await handle(request);
  await page.goto(`/en/book/${h}`);
  await expect(page.locator('.bk-profile-head')).toBeVisible();
  await expect(page.getByText(et.title)).toHaveCount(0);
  await page.goto(`/en/book/${h}/${et.slug}`);
  await expect(page.getByText(et.title).first()).toBeVisible();
  await page.goto(`/en/app/calendar/event-types/${et.id}?tab=share`);
  await expect(page.getByRole('switch', { name: /Secret event type/ })).toBeChecked();
});

test('Cal: encuesta de horario de punta a punta (crear, votar como invitado y reservar)', async ({ page, browser }) => {
  await page.goto('/en/app/calendar/polls');
  await page.getByRole('button', { name: /New poll/ }).first().click();
  const title = `Kickoff ${uid()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create poll' }).click();
  await expect(page).toHaveURL(/\/app\/calendar\/polls\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
  const link = (await page.locator('.cal-share-url .data').first().innerText()).trim();
  expect(link).toMatch(/\/book\/poll\/[A-Za-z0-9_-]+$/);

  // Invitado anónimo, en otro contexto y a 390 px.
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gp = await guest.newPage();
  await gp.goto(new URL(link).pathname);
  await expect(gp.getByRole('heading', { name: title })).toBeVisible();
  await gp.locator('.bk-poll-option input').first().check();
  await gp.getByLabel('Name').fill('Ana Votante');
  await gp.getByLabel('Email').fill('ana.votante@example.com');
  await gp.getByRole('button', { name: 'Send my vote' }).click();
  await expect(gp.getByRole('heading', { name: 'Thanks for voting' })).toBeVisible();
  expect(await gp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await guest.close();

  await page.reload();
  await expect(page.getByText('Ana Votante').first()).toBeVisible();
  await page.getByRole('button', { name: 'Book this time' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Book this time' }).click();
  await expect(page.getByText('Meeting booked and invitations sent.')).toBeVisible();
  await page.goto('/en/app/calendar/bookings?q=ana.votante');
  await expect(page.getByText('Ana Votante').first()).toBeVisible();
});

test('Cal: agendar en nombre de un invitado desde Reservas y exportar CSV', async ({ page, request }) => {
  const et = await eventType(request);
  await page.goto('/en/app/calendar/bookings');
  await page.getByRole('button', { name: 'New booking' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Event type').selectOption(et.id);
  const day = new Date(Date.now() + 3 * 86_400_000);
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  await dialog.locator('input[type="date"]').fill(ymd);
  await dialog.getByRole('radio').first().click();
  await dialog.getByLabel('Invitee name').fill('Juan Agendado');
  await dialog.getByLabel('Invitee email').fill('juan.agendado@example.com');
  await dialog.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Booked for Juan Agendado.')).toBeVisible();
  await expect(page.getByText('Booked by the team').first()).toBeVisible();

  const csv = await request.get('/api/calendar/bookings/export?q=juan.agendado');
  expect(csv.headers()['content-type']).toContain('text/csv');
  const text = await csv.text();
  expect(text).toContain('booking_id,event_type,status');
  expect(text).toContain('juan.agendado@example.com');
});

test('Cal: Google y Outlook (fake): elegir calendarios bloquea horarios ocupados', async ({ page, request }) => {
  const et = await eventType(request);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const slotsAt = async () =>
    ((await (await request.get(`/api/calendar/event-types/${et.id}/slots?date=${tomorrow}&timezone=UTC`)).json()) as { slots: Array<{ start: string }> }).slots.map(
      (s) => s.start.slice(11, 16),
    );

  await page.goto('/en/app/calendar/settings?tab=connections');
  const google = page.locator('.cal-conn').filter({ hasText: 'Google Calendar' });
  await google.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Google Calendar connected.')).toBeVisible();
  await expect(google.getByText(/Connected as/)).toBeVisible();
  // El calendario de equipo falso tiene un evento mañana de 13 a 14 UTC.
  expect(await slotsAt()).toContain('13:30');
  await google.getByLabel(/Team/).check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Changes saved').first()).toBeVisible();
  await expect.poll(slotsAt).not.toContain('13:30');

  const outlook = page.locator('.cal-conn').filter({ hasText: 'Outlook' });
  await outlook.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Outlook connected.')).toBeVisible();
  await expect(page.locator('.cal-conn').filter({ hasText: 'Outlook' }).getByText(/Connected as/)).toBeVisible();

  // iCloud por CalDAV (servidor falso): Apple ID + contraseña de app.
  const icloud = page.locator('.cal-conn').filter({ hasText: 'iCloud' });
  await icloud.getByRole('button', { name: 'Connect' }).click();
  await icloud.getByLabel('Apple ID').fill('demo@icloud.com');
  await icloud.getByLabel('App-specific password').fill('abcd-efgh-ijkl-mnop');
  await icloud.getByRole('button', { name: 'Connect iCloud' }).click();
  await expect(icloud.getByText('Connected as demo@icloud.com')).toBeVisible();
  await expect(icloud.getByLabel('Work')).toBeVisible();
});

test('Cal: workflow por SMS al reservar se guarda y se ve al volver', async ({ page, request }) => {
  const et = await eventType(request);
  await page.goto(`/en/app/calendar/event-types/${et.id}?tab=advanced`);
  await page.getByRole('button', { name: 'Add step' }).click();
  const step = page.locator('.cal-step').last();
  await step.getByLabel('Channel').selectOption('sms');
  await step.getByLabel('When').selectOption('booked');
  await step.getByLabel('Text').fill('Thanks {{guest.name}}, see you {{start}}');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved').first()).toBeVisible();
  await page.reload();
  const saved = page.locator('.cal-step').last();
  await expect(saved.getByLabel('Channel')).toHaveValue('sms');
  await expect(saved.getByLabel('When')).toHaveValue('booked');
});

test('Cal: marca, privacidad, actividad y analytics por persona', async ({ page, request }) => {
  const et = await eventType(request);
  const h = await handle(request);
  // Sacar "Powered by" desde Ajustes › Perfil.
  await page.goto('/en/app/calendar/settings');
  await page.getByRole('switch', { name: /Hide “Powered by zerosoft”/ }).check();
  await page.locator('form').filter({ hasText: 'Hide “Powered by zerosoft”' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Changes saved').first()).toBeVisible();
  await page.goto(`/en/book/${h}/${et.slug}`);
  await expect(page.locator('.powered-by')).toBeHidden();
  await request.post('/api/calendar/config', { data: { hideBranding: false } });

  // Borrar los datos de un invitado.
  const day = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
  const { slots } = (await (await request.get(`/api/calendar/event-types/${et.id}/slots?date=${day}&timezone=UTC`)).json()) as { slots: Array<{ start: string }> };
  const email = `gdpr-${uid()}@example.com`;
  expect((await request.post('/api/calendar/bookings', { data: { eventTypeId: et.id, email, name: 'Gdpr', start: slots[0].start, timezone: 'UTC' } })).status()).toBe(201);
  await page.goto('/en/app/calendar/settings?tab=privacy');
  await page.getByLabel('Invitee email').fill(email);
  await page.getByRole('button', { name: 'Find data' }).click();
  await expect(page.getByText('1 booking (1 upcoming)')).toBeVisible();
  await page.getByRole('button', { name: `Delete data of ${email}` }).click();
  await expect(page.getByText(`The data of ${email} was deleted.`)).toBeVisible();

  await page.goto('/en/app/calendar/settings?tab=activity');
  await expect(page.getByText('deleted the data of an invitee').first()).toBeVisible();
  await page.getByLabel('Show').selectOption('event_type');
  await expect(page.getByText('created the event type').first()).toBeVisible();

  await page.goto('/en/app/calendar/analytics');
  await expect(page.getByLabel('Event type', { exact: true })).toBeVisible();
  const exp = page.getByRole('link', { name: 'Export CSV' });
  await expect(exp).toHaveAttribute('href', /\/api\/calendar\/analytics\/export\?from=/);
  const csv = await request.get((await exp.getAttribute('href'))!);
  expect(await csv.text()).toContain('from,to,created');
});

test('Cal: el invitado reconfirma desde el link del workflow', async ({ page, request }) => {
  const et = await eventType(request);
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const { slots } = (await (await request.get(`/api/calendar/event-types/${et.id}/slots?date=${day}&timezone=UTC`)).json()) as { slots: Array<{ start: string }> };
  const booking = (await (
    await request.post('/api/calendar/bookings', { data: { eventTypeId: et.id, email: 'reconf@example.com', name: 'Re', start: slots[0].start, timezone: 'UTC' } })
  ).json()) as { manageToken: string };
  await page.goto(`/en/book/manage/${booking.manageToken}?reconfirm=1`);
  await page.getByRole('button', { name: 'Yes, I’ll be there' }).click();
  await expect(page.getByText('Thanks, your attendance is confirmed.')).toBeVisible();
  await page.goto('/en/app/calendar/bookings?q=reconf@example.com');
  await expect(page.getByText('Reconfirmed').first()).toBeVisible();
});
