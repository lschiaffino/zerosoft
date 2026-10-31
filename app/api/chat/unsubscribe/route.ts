import { NextResponse } from 'next/server';
import { unsubscribeVisitor, verifyUnsubscribeToken } from '@/lib/chat-campaigns';
import { escapeHtml } from '@/lib/email';
import { limitByIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const COPY = {
  en: { title: 'Unsubscribe', ask: 'Stop getting these emails?', button: 'Unsubscribe', done: 'Done. You won’t get more of these emails.', bad: 'This link isn’t valid.' },
  es: { title: 'Darse de baja', ask: '¿Dejar de recibir estos emails?', button: 'Darme de baja', done: 'Listo. No vas a recibir más estos emails.', bad: 'Este link no es válido.' },
  pt: { title: 'Cancelar inscrição', ask: 'Parar de receber estes e-mails?', button: 'Cancelar inscrição', done: 'Pronto. Você não vai mais receber estes e-mails.', bad: 'Este link não é válido.' },
};

function copy(req: Request) {
  const lang = (req.headers.get('accept-language') ?? '').slice(0, 2).toLowerCase();
  return lang === 'es' ? COPY.es : lang === 'pt' ? COPY.pt : COPY.en;
}

function page(title: string, inner: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark}body{font:16px system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px}button{font:inherit;padding:8px 14px;border:1px solid currentColor;border-radius:6px;background:none;color:inherit;cursor:pointer}</style></head><body>${inner}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** GET pide confirmación (los antivirus abren los links); POST da de baja, también con un clic desde el cliente de correo. */
export async function GET(req: Request) {
  const c = copy(req);
  const token = new URL(req.url).searchParams.get('t') ?? '';
  if (!verifyUnsubscribeToken(token)) return page(c.title, `<p>${escapeHtml(c.bad)}</p>`, 400);
  return page(c.title, `<p>${escapeHtml(c.ask)}</p><form method="post"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">${escapeHtml(c.button)}</button></form>`);
}

export async function POST(req: Request) {
  const limited = await limitByIp(req, 'chat-unsubscribe', 30, 60);
  if (limited) return limited;
  const c = copy(req);
  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const token = String(form?.get('t') ?? url.searchParams.get('t') ?? '');
  const id = verifyUnsubscribeToken(token);
  if (!id || !(await unsubscribeVisitor(id))) return page(c.title, `<p>${escapeHtml(c.bad)}</p>`, 400);
  return page(c.title, `<p>${escapeHtml(c.done)}</p>`);
}
