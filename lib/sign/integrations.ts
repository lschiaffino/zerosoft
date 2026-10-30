/**
 * Sign con otras apps. Server-only.
 *
 * - CRM: un sobre se arma desde un deal o un contacto (el contacto queda de
 *   firmante) y, completo, el PDF firmado queda adjunto al registro. El
 *   adjunto es un link a la ruta privada de Sign, nunca un archivo público.
 * - Docs: una página (con los permisos de Docs de la persona) como PDF.
 * - Hiring: una oferta aprobada sale a firmar; completa la acepta y
 *   rechazada la rechaza (lib/hiring/offers.ts).
 * - People: la app no está en main; offer letters y políticas se mandan por
 *   la API (POST /api/sign/envelopes con links app "people").
 */
import { getDb } from '../db';
import { userCanUseApp } from '../workspace';
import type { SessionUser } from '../session';
import { getContact, getDeal } from '../crm';
import { canSeeOwner, sessionScope } from '../crm-visibility';
import { createRecordFile } from '../crm-files';
import { docsActorFor } from '../docs-platform-access';
import { getPage } from '../docs-platform';
import { blocksToPdf, needsUnicodeFont } from '../docs-pdf';
import type { DocsBlock } from '../docs-types';
import { markOfferSentForSignature, offerForSignature, reopenOfferFromSign, settleOfferFromSign } from '../hiring/offers';
import type { HiringActor } from '../hiring/types';
import { addEvent, createEnvelope, parseJson, saveFields, saveRecipients, sendEnvelope, setDocument, type EnvelopeLink, type EnvelopeRow } from './core';
import { readSignFile } from './files';
import { textToPdf } from './pdf';
import { SignError, type SignActor } from './types';

// ---------- CRM ----------

export interface CrmPrefill {
  link: EnvelopeLink;
  title: string;
  recipient: { name: string; email: string } | null;
}

/** "deal:<id>" o "contact:<id>" → vínculo y firmante sugerido, si la persona ve el registro en el CRM. */
export async function crmPrefill(user: SessionUser, ref: string): Promise<CrmPrefill | null> {
  if (!userCanUseApp(user, 'crm') || user.role === 'guest') return null;
  const m = /^(deal|contact):([\w-]{1,80})$/.exec(ref);
  if (!m) return null;
  const scope = await sessionScope(user);
  if (m[1] === 'deal') {
    const d = await getDeal(user.id, m[2]);
    if (!d || !canSeeOwner(scope, d.deal.owner_id, user.id)) return null;
    const c = d.contacts.find((x) => x.email) ?? null;
    return {
      link: { app: 'crm', kind: 'deal', id: d.deal.id, label: d.deal.name },
      title: d.deal.name,
      recipient: c ? { name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email, email: c.email } : null,
    };
  }
  const c = await getContact(user.id, m[2]);
  if (!c || !canSeeOwner(scope, c.contact.owner_id, user.id)) return null;
  const name = [c.contact.first_name, c.contact.last_name].filter(Boolean).join(' ') || c.contact.email;
  return { link: { app: 'crm', kind: 'contact', id: c.contact.id, label: name }, title: name, recipient: c.contact.email ? { name, email: c.contact.email } : null };
}

/**
 * Completo: el PDF firmado como adjunto del deal o contacto. El adjunto es un
 * link a la página del sobre en Sign (no al archivo): quien puede verlo lo baja
 * de ahí; quien no, ve un aviso claro de que no tiene acceso.
 */
async function attachToCrm(env: EnvelopeRow, link: EnvelopeLink): Promise<void> {
  if (link.kind !== 'deal' && link.kind !== 'contact') return;
  const table = link.kind === 'deal' ? 'crm_deals' : 'crm_contacts';
  const exists = await getDb().prepare(`SELECT 1 AS one FROM ${table} WHERE id = ? AND user_id = ?`).get(link.id, env.workspace_id);
  if (!exists) return;
  const name = `${(env.document_name || env.title).replace(/\.pdf$/i, '').slice(0, 120)} (signed).pdf`;
  const size = env.final_ref ? ((await readSignFile(env.final_ref))?.length ?? 0) : 0;
  await createRecordFile(env.workspace_id, link.kind, link.id, { filename: name, contentType: 'application/pdf', size, url: `/app/sign/envelopes/${env.id}?from=crm`, uploadedBy: env.created_by });
  await addEvent(env.id, 'crm_attached', { detail: { kind: link.kind, id: link.id } });
}

// ---------- Docs ----------

/** Página de Docs → PDF (con los permisos de Docs de la persona). */
export async function docsPagePdf(user: SessionUser, actor: SignActor, pageId: string): Promise<{ bytes: Buffer; name: string; title: string }> {
  if (!userCanUseApp(user, 'docs')) throw new SignError('docs_unavailable', 403);
  const docs = await docsActorFor(actor.ws, actor.person);
  if (!docs) throw new SignError('docs_unavailable', 403);
  let page;
  try {
    page = await getPage(docs, pageId.slice(0, 80), { blocks: true });
  } catch {
    throw new SignError('not_found', 404);
  }
  const blocks = (page.blocks ?? []) as DocsBlock[];
  if (needsUnicodeFont(page.title, blocks)) throw new SignError('pdf_unicode', 422);
  const bytes = await blocksToPdf(blocks, page.title || 'Untitled');
  return { bytes, name: `${(page.title || 'page').slice(0, 100)}.pdf`, title: page.title || 'Untitled' };
}

// ---------- Hiring ----------

/**
 * Oferta aprobada → sobre con la carta como PDF, el candidato de firmante
 * (firma y fecha al pie de la última página) y enviado. Quien lo pide tiene
 * que poder gestionar al candidato en Hiring y tener Sign.
 */
export async function sendHiringOffer(user: SessionUser, actor: SignActor, offerId: string): Promise<EnvelopeRow> {
  if (!userCanUseApp(user, 'hiring')) throw new SignError('hiring_unavailable', 403);
  const hActor: HiringActor = { ws: actor.ws, person: actor.person, admin: actor.admin };
  let data;
  try {
    data = await offerForSignature(hActor, offerId);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'not_found';
    throw new SignError(code, code === 'not_found' ? 404 : 409);
  }
  const bytes = await textToPdf(data.jobTitle, data.offer.body);
  const env = await createEnvelope(actor, {
    title: `${data.jobTitle} · ${data.candidate.name}`,
    locale: data.locale,
    source: 'hiring',
    links: [{ app: 'hiring', kind: 'offer', id: data.offer.id, label: data.candidate.name }],
  });
  const withDoc = await setDocument(actor, env.id, { bytes, name: `offer-${data.candidate.name}.pdf` });
  const [r] = await saveRecipients(actor, env.id, [{ role: 'signer', name: data.candidate.name, email: data.candidate.email, routingOrder: 1 }]);
  const pages = parseJson<Array<{ w: number; h: number }>>(withDoc.pages, []);
  await saveFields(actor, env.id, [
    { recipientId: r.id, kind: 'signature', page: pages.length, x: 0.1, y: 0.8, w: 0.32, h: 0.07 },
    { recipientId: r.id, kind: 'date', page: pages.length, x: 0.55, y: 0.83, w: 0.25, h: 0.035 },
  ]);
  const sent = await sendEnvelope(actor, env.id);
  await markOfferSentForSignature(hActor, offerId, env.id);
  return sent;
}

async function settleHiring(env: EnvelopeRow, link: EnvelopeLink, kind: SignHookKind, who: { name: string; reason?: string } | null): Promise<void> {
  if (link.kind !== 'offer') return;
  if (kind === 'voided' || kind === 'expired') {
    await reopenOfferFromSign(env.workspace_id, link.id, env.id);
    return;
  }
  const signer = who ?? ((await getDb().prepare("SELECT name, ip, user_agent FROM sign_recipients WHERE envelope_id = ? AND role = 'signer' ORDER BY routing_order LIMIT 1").get(env.id)) as { name: string } | undefined) ?? null;
  if (!signer) return;
  const meta = (await getDb().prepare("SELECT ip, user_agent FROM sign_recipients WHERE envelope_id = ? AND role = 'signer' ORDER BY signed_at DESC LIMIT 1").get(env.id)) as { ip: string; user_agent: string } | undefined;
  await settleOfferFromSign(env.workspace_id, link.id, kind === 'completed' ? 'accept' : 'decline', { name: signer.name, reason: who?.reason }, { ip: meta?.ip ?? '', ua: meta?.user_agent ?? '' }).catch((err) => {
    console.error('[sign] no se pudo actualizar la oferta de Hiring', err instanceof Error ? err.message : err);
  });
}

// ---------- Ganchos al cerrar ----------

export type SignHookKind = 'completed' | 'declined' | 'voided' | 'expired';

export async function runIntegrations(kind: SignHookKind, env: EnvelopeRow, who: { name: string; email: string; reason?: string } | null): Promise<void> {
  for (const link of parseJson<EnvelopeLink[]>(env.links, [])) {
    try {
      if (link.app === 'crm' && kind === 'completed') await attachToCrm(env, link);
      if (link.app === 'hiring') await settleHiring(env, link, kind, who);
    } catch (err) {
      console.error('[sign] integración', link.app, err instanceof Error ? err.message : err);
    }
  }
}
