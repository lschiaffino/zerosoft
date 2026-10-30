import { NextRequest } from 'next/server';
import { applyPublic, publicApplySchema } from '@/lib/hiring/candidates';
import { HiringError } from '@/lib/hiring/types';
import { hFail, hiringLimit, hJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * POST multipart (handle, job, name, email, phone, linkedin, answers[<id>],
 * consent, keepConsent, utm_*, referrer, resume): postulación desde la página
 * de empleos. Límite por IP (10 cada 10 minutos por página) y un campo trampa
 * (`website`, oculto para personas): si viene completo, se responde como si
 * nada y no se guarda.
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return hJson({ error: 'invalid_input' }, 400);
  }
  const handle = str(form.get('handle')).toLowerCase().slice(0, 40);
  const limited = await hiringLimit(req, 'apply', 10, 600, handle);
  if (limited) return limited;
  if (str(form.get('website')).trim()) return hJson({ ok: true }, 201);
  const answers: Record<string, string> = {};
  const utm: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== 'string') continue;
    const m = /^answers\[([a-z0-9_-]{1,40})\]$/.exec(k);
    if (m) answers[m[1]] = v;
    if (/^utm_(source|medium|campaign|term|content)$/.test(k)) utm[k] = v.slice(0, 200);
  }
  const yes = (v: string) => v === 'on' || v === 'true';
  const parsed = publicApplySchema.safeParse({
    name: str(form.get('name')),
    email: str(form.get('email')),
    phone: str(form.get('phone')),
    linkedin: str(form.get('linkedin')),
    answers,
    consent: yes(str(form.get('consent'))),
    keepConsent: yes(str(form.get('keepConsent'))),
    utm,
    referrer: str(form.get('referrer')),
    source: str(form.get('source')) || null,
  });
  if (!parsed.success) return hJson({ error: 'invalid_input' }, 400);
  const file = form.get('resume');
  const resume = file && typeof file !== 'string' && file.size > 0 ? { bytes: Buffer.from(await file.arrayBuffer()), filename: file.name } : null;
  try {
    const res = await applyPublic(handle, str(form.get('job')).slice(0, 90), parsed.data, resume);
    return hJson({ ok: true, duplicate: res.existing }, 201);
  } catch (err) {
    if (err instanceof HiringError && err.status === 404) return hJson({ error: 'not_found' }, 404);
    return hFail(err);
  }
}
