import { expect, test } from '@playwright/test';

const uid = () => Math.random().toString(36).slice(2, 8);

/** Event type disponible todos los días 09–17 UTC y una reserva para dentro de 3 días. */
async function setupBooking(request: import('@playwright/test').APIRequestContext) {
  const slug = `g-${uid()}`;
  const eventType = await (
    await request.post('/api/calendar/event-types', { data: { slug, title: 'Guest flow', durationMin: 30, active: true } })
  ).json();
  const rules = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '17:00' }));
  await request.post(`/api/calendar/event-types/${eventType.id}/availability`, { data: { rules } });
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const { slots } = await (await request.get(`/api/calendar/event-types/${eventType.id}/slots?date=${day}&timezone=UTC`)).json();
  const res = await request.post('/api/calendar/bookings', {
    data: { eventTypeId: eventType.id, email: 'guest@example.com', name: 'Guest', start: slots[0].start, timezone: 'UTC' },
  });
  expect(res.status()).toBe(201);
  const booking = await res.json();
  expect(booking.manageToken).toHaveLength(40);
  expect(booking).not.toHaveProperty('host_user_id');
  return { eventType, day, slots: slots as Array<{ start: string }>, booking };
}

test('Cal: el invitado reprograma desde su link y el horario viejo queda libre', async ({ page, request }) => {
  const { eventType, day, slots, booking } = await setupBooking(request);
  await page.goto(`/en/book/manage/${booking.manageToken}`);
  await expect(page.getByText('Guest flow')).toBeVisible();
  await page.getByRole('button', { name: 'Reschedule' }).click();

  // Elegir el mismo día y el último slot ofrecido.
  await page.locator('select').first().selectOption('UTC');
  const dayNum = String(Number(day.slice(8, 10)));
  if (Number(day.slice(8, 10)) < new Date().getUTCDate()) await page.getByRole('button', { name: '›' }).click();
  await page.getByRole('button', { name: dayNum, exact: true }).click();
  const slotButtons = page.locator('button.booking-slot');
  await expect(slotButtons.first()).toBeVisible();
  await slotButtons.last().click();
  await page.getByRole('button', { name: 'Confirm new time' }).click();
  await expect(page.getByText('Rescheduled')).toBeVisible();

  const after = (await (await request.get(`/api/calendar/event-types/${eventType.id}/slots?date=${day}&timezone=UTC`)).json())
    .slots as Array<{ start: string }>;
  expect(after.map((s) => s.start)).toContain(slots[0].start);
});

test('Cal: el invitado cancela desde su link', async ({ page, request }) => {
  const { booking } = await setupBooking(request);
  await page.goto(`/en/book/manage/${booking.manageToken}`);
  await page.getByRole('button', { name: 'Cancel booking' }).click();
  await page.getByLabel('Reason (optional)').fill('Me surgió algo');
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByText('This booking is cancelled')).toBeVisible();

  const again = await request.post(`/api/calendar/bookings/manage/${booking.manageToken}`, { data: { action: 'cancel' } });
  expect(again.status()).toBe(409);
  expect((await request.get('/en/book/manage/token-invalido-que-no-existe-0000000000')).status()).toBe(404);
});
