/**
 * Forms: lo que pasa después de una respuesta completa.
 *
 * - CRM (si el form lo pide): un email nuevo crea el contacto con el upsert
 *   seguro del CRM (findOrCreateContact). Un email que ya existe NO toca ese
 *   contacto: cualquiera puede escribir el email de otro en un formulario
 *   público, así que queda una nota suelta "sin verificar" (misma regla que
 *   los formularios de Agents, lib/agents-forms.ts). Los valores van sin
 *   = + - @ al principio.
 * - Avisos in-app a las personas elegidas (solo si siguen teniendo acceso al
 *   form) y emails a las direcciones del form.
 * - Webhook propio del form (firmado, por safeFetch) y el evento de Flow
 *   forms.response.submitted (solo para flows de personas con acceso).
 * - Ganchos para otras apps (registerFormsResponseHook): Hiring y People
 *   pueden escuchar respuestas de formularios embebidos más adelante.
 *
 * Nada de esto puede romper el envío: cada paso atrapa sus errores.
 */
import { localized } from '../notification-copy';
import { getDb } from '../db';
import { crmSafe } from '../agents-forms';
import { after } from 'next/server';
import { emitEvent } from '../events';
import { open } from '../secret-box';
import { signPayload } from '../webhooks';
import { personCanAccess, settingsOf, type FormRow } from './core';
import { answerDisplay, escapeHtml, pipe } from './engine';
import type { Answers, FormDefinition } from './types';

export interface CompletedResponse {
  id: string;
  answers: Answers;
  hidden: Record<string, string>;
  vars: Record<string, number>;
  endingId: string;
  lang: string;
}

export type FormsResponseHook = (event: { workspaceId: string; formId: string; formName: string; response: CompletedResponse }) => Promise<void> | void;
const hooks: FormsResponseHook[] = [];

/** Emails de aviso por form y por día (entre todas las direcciones). */
export const NOTIFY_EMAILS_PER_DAY = 200;

/** Para Hiring, People u otra app que embeba un form y quiera enterarse de cada respuesta. */
export function registerFormsResponseHook(fn: FormsResponseHook): () => void {
  hooks.push(fn);
  return () => {
    const i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  };
}

function textAnswer(def: FormDefinition, answers: Answers, qid: string): string {
  const q = def.questions.find((x) => x.id === qid);
  if (!q) return '';
  const v = answers[qid];
  return typeof v === 'string' ? v.trim() : v === undefined ? '' : answerDisplay(q, v);
}

/** Líneas "Pregunta: respuesta" (texto plano). */
export function responseLines(def: FormDefinition, answers: Answers): string[] {
  return def.questions
    .filter((q) => answers[q.id] !== undefined)
    .map((q) => `${pipe(q.title, def, { answers }) || q.ref}: ${answerDisplay(q, answers[q.id])}`);
}

/**
 * CRM: crea el contacto si el email es nuevo; si ya existía, solo una nota
 * suelta sin tocarlo. Devuelve el contacto creado (o null).
 */
export async function syncCrmContact(row: Pick<FormRow, 'workspace_id' | 'name' | 'settings'>, def: FormDefinition, answers: Answers): Promise<{ contactId: string | null; created: boolean; unverified: boolean }> {
  const s = settingsOf(row).crm;
  if (!s.enabled || !s.email) return { contactId: null, created: false, unverified: false };
  const email = textAnswer(def, answers, s.email).toLowerCase();
  if (!email || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)) return { contactId: null, created: false, unverified: false };
  const name = crmSafe(s.name ? textAnswer(def, answers, s.name) : '');
  const phone = s.phone ? textAnswer(def, answers, s.phone).replace(/^[\s=+\-@]+(?=\D)/, '') : '';
  const company = crmSafe(s.company ? textAnswer(def, answers, s.company) : '');
  const note = responseLines(def, answers)
    .map((l) => crmSafe(l))
    .join('\n')
    .slice(0, 8000);
  const { createActivity } = await import('../crm');
  const existing = (await getDb().prepare('SELECT id FROM crm_contacts WHERE user_id = ? AND lower(email) = lower(?) LIMIT 1').get(row.workspace_id, email)) as { id: string } | undefined;
  if (existing) {
    // Email que cualquiera pudo escribir: nadie pisa ni anota el contacto de otra persona.
    await createActivity(row.workspace_id, { type: 'note', subject: `Forms: ${row.name} (${email}, unverified)`, body: note });
    return { contactId: null, created: false, unverified: true };
  }
  const { findOrCreateContact } = await import('../crm-integrations');
  const { contact, created } = await findOrCreateContact(row.workspace_id, { email, name: name || null, phone: /^[+\d][\d\s().-]{4,30}$/.test(phone) ? phone : null, source: 'form', assign: 'form' });
  if (!created) {
    await createActivity(row.workspace_id, { type: 'note', subject: `Forms: ${row.name} (${email}, unverified)`, body: note });
    return { contactId: null, created: false, unverified: true };
  }
  await createActivity(row.workspace_id, { type: 'note', subject: `Forms: ${row.name}`, body: [note, company ? `Company: ${company}` : ''].filter(Boolean).join('\n'), contactId: contact.id });
  return { contactId: contact.id, created: true, unverified: false };
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

export async function afterResponse(row: FormRow, def: FormDefinition, r: CompletedResponse): Promise<void> {
  const s = settingsOf(row);
  const db = getDb();
  const lines = responseLines(def, r.answers);
  const href = `/app/forms/${row.id}/responses/${r.id}`;

  try {
    const crm = await syncCrmContact(row, def, r.answers);
    if (crm.contactId) await db.prepare('UPDATE forms_responses SET contact_id = ? WHERE id = ?').run(crm.contactId, r.id);
  } catch (err) {
    console.error('[forms] crm', err instanceof Error ? err.message : err);
  }

  try {
    const { createNotification } = await import('../notifications');
    for (const pid of s.notifyPeople) {
      if (!(await personCanAccess(row, pid))) continue;
      await createNotification({ userId: pid, type: 'forms_response', title: localized('formResponse', { name: row.name }), body: lines.slice(0, 6).join('\n').slice(0, 1000), href, sourceType: 'forms_response', sourceId: r.id });
    }
  } catch (err) {
    console.error('[forms] notify', err instanceof Error ? err.message : err);
  }

  const payload = {
    form: { id: row.id, name: row.name, slug: row.slug },
    response: {
      id: r.id,
      submittedAt: new Date().toISOString(),
      lang: r.lang,
      ending: r.endingId,
      answers: Object.fromEntries(def.questions.filter((q) => r.answers[q.id] !== undefined).map((q) => [q.ref, answerDisplay(q, r.answers[q.id])])),
      hidden: r.hidden,
      variables: r.vars,
      url: `${baseUrl()}/en${href}`,
    },
  };

  // Emails, webhook, Flow y ganchos: después de responder (after), así una
  // casilla o un servidor lento no demoran ni rompen el envío.
  const job = async () => {
    if (s.notifyEmails.length) {
      try {
        // Tope diario de emails de aviso por form (un form abierto no puede volverse un relay).
        const { rateLimit } = await import('../rate-limit');
        {
          const { sendEmail } = await import('../email');
          const html = `<p>New response to <strong>${escapeHtml(row.name)}</strong>.</p><table>${def.questions
            .filter((q) => r.answers[q.id] !== undefined)
            .map((q) => `<tr><td style="padding:4px 8px;color:#555">${escapeHtml(q.title || q.ref)}</td><td style="padding:4px 8px">${escapeHtml(answerDisplay(q, r.answers[q.id]))}</td></tr>`)
            .join('')}</table><p><a href="${escapeHtml(`${baseUrl()}/en${href}`)}">Open in Forms</a></p>`;
          for (const to of s.notifyEmails) {
            if (!(await rateLimit(`forms-notify:${row.id}`, NOTIFY_EMAILS_PER_DAY, 86_400)).ok) break;
            await sendEmail({ to, subject: `New response: ${row.name}`.slice(0, 200), text: `${lines.join('\n')}\n\n${baseUrl()}/en${href}`, html });
          }
        }
      } catch (err) {
        console.error('[forms] email', err instanceof Error ? err.message : err);
      }
    }

    if (s.webhookUrl && row.webhook_secret) {
      try {
        const { safeFetch } = await import('../safe-fetch');
        const body = JSON.stringify({ type: 'forms.response.submitted', data: payload });
        await safeFetch(s.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'Zerosoft-Signature': signPayload(open(row.webhook_secret), body) }, body }, 8000);
      } catch (err) {
        console.error('[forms] webhook', err instanceof Error ? err.message : 'error');
      }
    }

    try {
      await emitEvent(row.workspace_id, 'forms.response.submitted', payload, { audience: (creatorId) => personCanAccess(row, creatorId) });
    } catch (err) {
      console.error('[forms] flow', err instanceof Error ? err.message : err);
    }

    for (const h of hooks) {
      try {
        await h({ workspaceId: row.workspace_id, formId: row.id, formName: row.name, response: r });
      } catch {
        /* un gancho no corta el envío */
      }
    }
  };
  try {
    after(job);
  } catch {
    // Fuera de un request (tests, scripts): en el momento.
    await job();
  }
}
