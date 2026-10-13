import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from '@/lib/email';

const msg = { to: 'a@b.com', subject: 's', text: 't' };

describe('sendEmail', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sin RESEND_API_KEY loguea en consola y devuelve ok', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await sendEmail(msg);
    expect(res).toMatchObject({ ok: true, provider: 'console' });
  });

  it('si Resend falla devuelve ok:false (para reintentar)', async () => {
    vi.stubEnv('RESEND_API_KEY', 'k');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 })));
    const res = await sendEmail(msg);
    expect(res).toMatchObject({ ok: false, provider: 'resend', error: 'boom' });
  });

  it('si Resend responde bien devuelve el id', async () => {
    vi.stubEnv('RESEND_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 })));
    const res = await sendEmail(msg);
    expect(res).toMatchObject({ ok: true, provider: 'resend', id: 'em_1' });
  });
});
