import { expect, test, type Page } from '@playwright/test';

/**
 * Voice graba el audio de la compu además del micrófono. Micrófono simulado de Chromium, y la
 * captura de pantalla simulada: getDisplayMedia devuelve una pista de audio (tono) y una de video
 * (canvas), o la app de escritorio simulada (window.zerosoftDesktop) entrega PCM por el puente.
 * Se mira qué fuentes ('me' = micrófono, 'them' = audio del sistema) suben como trozos.
 */
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
});

test.beforeEach(async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['microphone'], { origin: baseURL! });
  await page.addInitScript(() => {
    (window as unknown as { __zsVoiceChunkMs: number }).__zsVoiceChunkMs = 1500;
  });
});

/** Fuentes de los segmentos ya transcritos de la reunión (me, them, mixed). */
async function sourcesOf(page: Page, id: string): Promise<string[]> {
  const res = await page.request.get(`/api/voice/sessions/${id}`);
  const data = (await res.json()) as { segments?: Array<{ source: string }> };
  return [...new Set((data.segments ?? []).map((s) => s.source))].sort();
}

async function newSession(page: Page, title: string) {
  const { id } = (await (await page.request.post('/api/voice/sessions', { data: { title } })).json()) as { id: string };
  await page.goto(`/en/app/voice/meetings/${id}`, { waitUntil: 'networkidle' });
  return id;
}

test('navegador: comparte audio de la pestaña y se graba junto con el micrófono', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __displayAsked: number }).__displayAsked = 0;
    navigator.mediaDevices.getDisplayMedia = async () => {
      (window as unknown as { __displayAsked: number }).__displayAsked += 1;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 440;
      osc.connect(dest);
      osc.start();
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const video = canvas.captureStream(1).getVideoTracks();
      return new MediaStream([...video, ...dest.stream.getAudioTracks()]);
    };
  });
  const id = await newSession(page, `Tab audio ${Math.random().toString(36).slice(2, 6)}`);
  // Por defecto se pide el audio de la reunión (pestaña o sistema), sin tocar ningún ajuste.
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { __displayAsked: number }).__displayAsked)).toBe(1);
  await expect.poll(async () => (await sourcesOf(page, id)).join(','), { timeout: 40_000 }).toBe('me,them');
  const session = (await (await page.request.get(`/api/voice/sessions/${id}`)).json()) as { capture?: string };
  expect(session.capture ?? 'mic_tab').toBe('mic_tab');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: /Start recording|Keep recording/ })).toBeVisible({ timeout: 30_000 });
});

test('navegador: si no se comparte audio, avisa el motivo y no graba a medias', async ({ page }) => {
  await page.addInitScript(() => {
    // Pantalla compartida sin pista de audio (Chrome en Mac con "toda la pantalla").
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      return canvas.captureStream(1);
    };
  });
  await newSession(page, 'No audio share');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /has no audio/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
});

test('app de escritorio: el audio del sistema llega por el puente y sube como "them"', async ({ page }) => {
  await page.addInitScript(() => {
    // 250 ms de seno a 16 kHz, PCM de 16 bits en base64, por cada lectura.
    const n = 4000;
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 12000);
    let bin = '';
    new Uint8Array(pcm.buffer).forEach((b) => (bin += String.fromCharCode(b)));
    const b64 = btoa(bin);
    const w = window as unknown as { __sys: { started: number; stopped: number } };
    w.__sys = { started: 0, stopped: 0 };
    Object.defineProperty(window, 'zerosoftDesktop', {
      value: {
        version: '0.4.0',
        platform: 'darwin',
        systemAudio: true,
        dictation: false,
        startLogin() {},
        openSettings() {},
        async systemAudioStart() {
          w.__sys.started += 1;
          return 'ok';
        },
        async systemAudioRead() {
          return b64;
        },
        async systemAudioStop() {
          w.__sys.stopped += 1;
        },
      },
    });
  });
  const id = await newSession(page, 'Desktop system audio');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await sourcesOf(page, id)).join(','), { timeout: 40_000 }).toBe('me,them');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sys: { stopped: number } }).__sys.stopped), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('app de escritorio sin permiso de grabación de pantalla: graba el micrófono y explica cómo darlo', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'zerosoftDesktop', {
      value: {
        version: '0.4.0',
        platform: 'darwin',
        systemAudio: true,
        dictation: false,
        startLogin() {},
        openSettings() {},
        async systemAudioStart() {
          return 'denied';
        },
        async systemAudioRead() {
          return '';
        },
        async systemAudioStop() {},
      },
    });
  });
  const id = await newSession(page, 'Desktop denied');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('timer')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('alert').filter({ hasText: /Screen & System Audio Recording/ })).toBeVisible();
  await expect.poll(async () => (await sourcesOf(page, id)).join(','), { timeout: 40_000 }).toBe('mixed');
});
