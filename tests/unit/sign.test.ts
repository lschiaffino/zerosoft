import os from 'os';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getDb, upsertUser } from '@/lib/db';
import { canUseApp, ensureWorkspace } from '@/lib/workspace';
import type { ProductKey } from '@/lib/products';
import { scopesForApps } from '@/lib/api-scopes';
import { toolsFor } from '@/lib/assistant/tools';
import {
  activeRecipients,
  allActed,
  assertEditable,
  canManageEnvelope,
  canSeeEnvelope,
  checkOtp,
  clampBox,
  hashOtp,
  hashToken,
  maskEmail,
  OTP_MAX_ATTEMPTS,
  signingToken,
  SignError,
  TOKEN_RE,
  validateSubmission,
  type FieldLike,
  type RecipientLike,
  type SignActor,
} from '@/lib/sign/types';
import { sanitizePdf, sniffPdf, MAX_PDF_BYTES } from '@/lib/sign/pdf';
import {
  boxOf,
  copyEnvelope,
  createEnvelope,
  deleteEnvelope,
  envelopeFile,
  getEnvelopeRow,
  listEnvelopes,
  listFields,
  listRecipients,
  remindEnvelope,
  requireSee,
  saveFields,
  saveRecipients,
  sendEnvelope,
  setDocument,
  updateEnvelope,
  voidEnvelope,
} from '@/lib/sign/core';
import { declineSigning, publicState, resolveToken, runSignCron, sendOtp, sessionValid, submitSigning, verifyOtp } from '@/lib/sign/signing';
import { bulkSend, createTemplate, setTemplateDocument, updateTemplate, envelopeFromTemplate } from '@/lib/sign/templates';
import { cleanSignatureImage, sha256Hex } from '@/lib/esign';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-sign-uploads-${process.pid}`);
const MAIL = path.join(os.tmpdir(), `zs-sign-mail-${process.pid}.jsonl`);
process.env.EMAIL_CAPTURE_FILE = MAIL;

const uid = () => Math.random().toString(36).slice(2, 10);
const meta = { ip: '203.0.113.7', ua: 'vitest' };

/** JPEG mínimo válido (40x20) para la firma. */
const SIG = `data:image/jpeg;base64,${Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080014002801011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9',
  'hex',
).toString('base64')}`;

async function pdf(pages = 2): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return Buffer.from(await doc.save());
}

function mails(to: string): Array<{ to: string; subject: string; text: string; attachments: string[] }> {
  if (!existsSync(MAIL)) return [];
  return readFileSync(MAIL, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((m) => m.to === to);
}
const linkFrom = (text: string) => /\/sign\/([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;
const codeFrom = (text: string) => /\b(\d{6})\b/.exec(text)?.[1] ?? null;

interface World {
  owner: SignActor;
  member: SignActor;
  other: SignActor;
}

async function person(ws: string, teamId: string, role: 'admin' | 'member', apps = '["sign"]'): Promise<SignActor> {
  const email = `sg-${uid()}@example.com`;
  const u = await upsertUser({ email, name: `Person ${uid()}`, image: null });
  await getDb().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, u.id, role, apps);
  return { ws, person: u.id, admin: role === 'admin', email, name: u.name ?? '' };
}

let w: World;
beforeAll(async () => {
  const email = `sg-owner-${uid()}@example.com`;
  const o = await upsertUser({ email, name: 'Owner', image: null });
  const team = await ensureWorkspace(o.id);
  w = { owner: { ws: o.id, person: o.id, admin: true, email, name: 'Owner' }, member: await person(o.id, team.id, 'member'), other: await person(o.id, team.id, 'member') };
});

/** Sobre listo para enviar: 2 firmantes en orden con su campo de firma (y texto para el segundo). */
async function draft(actor: SignActor, opts: { otp?: boolean; order?: 'sequential' | 'parallel' } = {}) {
  const env = await createEnvelope(actor, { title: `Contract ${uid()}`, otpRequired: opts.otp ?? false, signingOrder: opts.order ?? 'sequential' });
  await setDocument(actor, env.id, { bytes: await pdf(2), name: 'contract.pdf' });
  const a = `a-${uid()}@example.com`;
  const b = `b-${uid()}@example.com`;
  const [r1, r2] = await saveRecipients(actor, env.id, [
    { role: 'signer', name: 'Ana Uno', email: a, routingOrder: 1 },
    { role: 'signer', name: 'Bruno Dos', email: b, routingOrder: 2 },
  ]);
  await saveFields(actor, env.id, [
    { recipientId: r1.id, kind: 'signature', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
    { recipientId: r1.id, kind: 'date', page: 1, x: 0.5, y: 0.82, w: 0.2, h: 0.03 },
    { recipientId: r2.id, kind: 'signature', page: 2, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
    { recipientId: r2.id, kind: 'text', page: 2, x: 0.1, y: 0.5, w: 0.3, h: 0.03, label: 'Title', required: true },
  ]);
  return { env, a, b, r1, r2 };
}

describe('Sign: reglas puras', () => {
  const R = (id: string, order: number, status: RecipientLike['status'] = 'sent', role: RecipientLike['role'] = 'signer'): RecipientLike => ({ id, routing_order: order, status, role });

  it('orden de firma: secuencial por grupos, paralelo todos, CC nunca', () => {
    const rs = [R('a', 1), R('b', 1), R('c', 2), R('cc', 3, 'created', 'cc')];
    expect(activeRecipients(rs, 'sequential').map((r) => r.id)).toEqual(['a', 'b']);
    expect(activeRecipients(rs, 'parallel').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    rs[0].status = 'signed';
    expect(activeRecipients(rs, 'sequential').map((r) => r.id)).toEqual(['b']);
    rs[1].status = 'approved';
    expect(activeRecipients(rs, 'sequential').map((r) => r.id)).toEqual(['c']);
    expect(allActed(rs)).toBe(false);
    rs[2].status = 'signed';
    expect(allActed(rs)).toBe(true);
    expect(allActed([R('cc', 1, 'created', 'cc')])).toBe(false);
  });

  it('aislamiento de campos: un id ajeno es 403, obligatorios y tipos se validan', () => {
    const fields: FieldLike[] = [
      { id: 'f1', recipient_id: 'r1', kind: 'signature', required: 1 },
      { id: 'f2', recipient_id: 'r1', kind: 'checkbox', required: 1 },
      { id: 'f3', recipient_id: 'r1', kind: 'dropdown', required: 0, options: '["A","B"]' },
      { id: 'g1', recipient_id: 'r2', kind: 'text', required: 1 },
    ];
    const err = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e as SignError;
      }
      throw new Error('no error');
    };
    expect(err(() => validateSubmission(fields, 'r1', { g1: 'hack', f2: true })).code).toBe('field_not_yours');
    expect(err(() => validateSubmission(fields, 'r1', { g1: 'hack' })).status).toBe(403);
    expect(err(() => validateSubmission(fields, 'r1', { nope: 'x' })).code).toBe('field_unknown');
    expect(err(() => validateSubmission(fields, 'r1', {})).code).toBe('required_missing');
    expect(err(() => validateSubmission(fields, 'r1', { f2: true, f3: 'C' })).code).toBe('invalid_value');
    const ok = validateSubmission(fields, 'r1', { f2: true, f3: 'B' });
    expect(ok.needsSignature).toBe(true);
    expect(Object.fromEntries(ok.values)).toEqual({ f1: 'signed', f2: 'true', f3: 'B' });
  });

  it('inmutable después de enviar', () => {
    expect(() => assertEditable({ status: 'draft' })).not.toThrow();
    for (const s of ['sent', 'completed', 'declined', 'voided', 'expired']) expect(() => assertEditable({ status: s })).toThrow('envelope_locked');
  });

  it('tokens: HMAC por (id, nonce), en la base solo el hash; otro nonce es otro token', () => {
    const t1 = signingToken('rcp_1', 'n1');
    expect(TOKEN_RE.test(t1)).toBe(true);
    expect(signingToken('rcp_1', 'n1')).toBe(t1);
    expect(signingToken('rcp_1', 'n2')).not.toBe(t1);
    expect(signingToken('rcp_2', 'n1')).not.toBe(t1);
    expect(hashToken(t1)).toBe(createHash('sha256').update(t1).digest('hex'));
    expect(hashToken(t1)).not.toContain(t1);
  });

  it('OTP: correcto, incorrecto, vencido y bloqueado después de 5 intentos', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    const row = { id: 'rcp_x', otp_hash: hashOtp('rcp_x', '123456'), otp_expires_at: '2026-10-30T12:05:00Z', otp_attempts: 0 };
    expect(checkOtp(row, '123456', now)).toBe('ok');
    expect(checkOtp(row, '654321', now)).toBe('wrong');
    expect(checkOtp(row, 'abc', now)).toBe('wrong');
    expect(checkOtp({ ...row, otp_expires_at: '2026-10-30T11:59:00Z' }, '123456', now)).toBe('expired');
    expect(checkOtp({ ...row, otp_attempts: OTP_MAX_ATTEMPTS }, '123456', now)).toBe('locked');
    expect(checkOtp({ ...row, otp_hash: null }, '123456', now)).toBe('none');
    // El hash es por destinatario: el mismo código de otro no sirve.
    expect(checkOtp({ ...row, id: 'rcp_y' }, '123456', now)).toBe('wrong');
    expect(maskEmail('ana.perez@empresa.com')).toBe('a******@e******.com');
  });

  it('permisos: quien creó, admins y destinatarios por email; gestionar solo quien creó o admin', () => {
    const env = { created_by: 'u1' };
    expect(canSeeEnvelope({ person: 'u1', admin: false, email: 'a@x.com' }, env)).toBe(true);
    expect(canSeeEnvelope({ person: 'u2', admin: true, email: 'b@x.com' }, env)).toBe(true);
    expect(canSeeEnvelope({ person: 'u3', admin: false, email: 'c@x.com' }, env, ['C@x.com'])).toBe(true);
    expect(canSeeEnvelope({ person: 'u3', admin: false, email: 'c@x.com' }, env, ['d@x.com'])).toBe(false);
    expect(canManageEnvelope({ person: 'u3', admin: false }, env)).toBe(false);
    expect(canUseApp({ role: 'member', apps: ['crm'] }, 'sign')).toBe(false);
    expect(canUseApp({ role: 'member', apps: ['sign'] }, 'sign')).toBe(true);
    expect(scopesForApps(['sign:read', 'crm:read'], ['crm'])).toEqual(['crm:read']);
    const names = (apps: '*' | ProductKey[]) => toolsFor({ role: 'member', apps }).map((t) => t.name);
    expect(names(['crm'])).not.toContain('sign_envelopes');
    expect(names(['sign'])).toEqual(expect.arrayContaining(['sign_envelopes', 'sign_envelope', 'sign_templates', 'propose_sign_send']));
  });

  it('cajas y campos dentro de la página', () => {
    const rs = [{ id: 'a', email: 'me@x.com', role: 'signer' as const, routing_order: 1, status: 'sent' as const }];
    expect(boxOf({ status: 'sent', signing_order: 'sequential' }, rs, 'me@x.com')).toBe('action');
    expect(boxOf({ status: 'sent', signing_order: 'sequential' }, rs, 'other@x.com')).toBe('waiting');
    expect(boxOf({ status: 'expired', signing_order: 'sequential' }, rs, 'me@x.com')).toBe('closed');
    expect(clampBox({ x: 0.95, y: -1, w: 0.2, h: 0.1 })).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.1 });
  });
});

describe('Sign: PDFs', () => {
  it('reconoce un PDF por sus bytes', async () => {
    expect(sniffPdf(await pdf(1))).toBe(true);
    expect(sniffPdf(Buffer.from('hello world, not a pdf at all'))).toBe(false);
    await expect(sanitizePdf(Buffer.from('<html><script>alert(1)</script></html>'))).rejects.toThrow('pdf_invalid');
    expect(MAX_PDF_BYTES).toBeLessThanOrEqual(4.5 * 1024 * 1024);
  });

  it('saca JavaScript, acciones, formularios y anotaciones activas', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    page.drawText('Hi', { x: 10, y: 10 });
    const ctx = doc.context;
    const js = ctx.register(ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert("pwned")') }));
    doc.catalog.set(PDFName.of('OpenAction'), js);
    doc.catalog.set(PDFName.of('AA'), ctx.obj({ WC: js }));
    doc.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('x'), js] }) }));
    page.node.set(PDFName.of('AA'), ctx.obj({ O: js }));
    const launch = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [0, 0, 10, 10], A: ctx.obj({ S: 'Launch', F: PDFString.of('calc.exe') }) }));
    const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com') }) }));
    page.node.set(PDFName.of('Annots'), ctx.obj([launch, link]));
    const dirty = Buffer.from(await doc.save({ useObjectStreams: false }));
    expect(dirty.toString('latin1')).toContain('/JavaScript');

    const clean = await sanitizePdf(dirty);
    const text = clean.bytes.toString('latin1');
    for (const bad of ['/JavaScript', '/JS', 'app.alert', '/OpenAction', '/AA', '/Launch', 'calc.exe', '/Widget']) expect(text, bad).not.toContain(bad);
    // Los links se quedan.
    expect(text).toContain('https://example.com');
    expect(clean.pages).toEqual([{ w: 300, h: 300 }]);
  });
});

describe('Sign: de punta a punta', () => {
  it('inmutable después de enviar: ni campos, ni destinatarios, ni documento, ni ajustes', async () => {
    const { env, r1 } = await draft(w.owner);
    await sendEnvelope(w.owner, env.id);
    await expect(updateEnvelope(w.owner, env.id, { title: 'x' })).rejects.toThrow('envelope_locked');
    await expect(saveRecipients(w.owner, env.id, [])).rejects.toThrow('envelope_locked');
    await expect(saveFields(w.owner, env.id, [{ recipientId: r1.id, kind: 'text', page: 1, x: 0, y: 0, w: 0.1, h: 0.1 }])).rejects.toThrow('envelope_locked');
    await expect(setDocument(w.owner, env.id, { bytes: await pdf(1), name: 'b.pdf' })).rejects.toThrow('envelope_locked');
    await expect(deleteEnvelope(w.owner, env.id)).rejects.toThrow('void_first');
    // Corregir = anular y copiar.
    await voidEnvelope(w.owner, env.id, 'Wrong amount');
    const copy = await copyEnvelope(w.owner, env.id);
    expect(copy.status).toBe('draft');
    expect(copy.document_hash).toBe((await getEnvelopeRow(w.owner.ws, env.id))!.document_hash);
    expect((await listFields(copy.id)).length).toBe(4);
  });

  it('no se envía sin firma para cada firmante', async () => {
    const env = await createEnvelope(w.owner, { title: 'Empty' });
    await expect(sendEnvelope(w.owner, env.id)).rejects.toThrow('not_ready');
  });

  it('orden, código por email, aislamiento, hashes y certificado', async () => {
    const { env, a, b, r1, r2 } = await draft(w.owner, { otp: true });
    await sendEnvelope(w.owner, env.id);
    // Solo el primero recibe el link; en la base, solo el hash.
    const t1 = linkFrom(mails(a).at(-1)!.text)!;
    expect(t1).toBeTruthy();
    expect(mails(b)).toHaveLength(0);
    const rows = await listRecipients(env.id);
    expect(rows.find((r) => r.id === r1.id)!.token_hash).toBe(hashToken(t1));
    expect(rows.find((r) => r.id === r2.id)!.token_hash).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(t1);

    // Sin código no se firma.
    let res = (await resolveToken(t1))!;
    expect(publicState(res, false)).toBe('otp');
    await expect(submitSigning(res, false, { consent: true, values: {}, signature: SIG }, meta)).rejects.toThrow('otp_required');
    // Código: incorrecto suma intentos, correcto abre la sesión.
    await sendOtp(res, meta);
    const code = codeFrom(mails(a).at(-1)!.text)!;
    await expect(verifyOtp(res, code === '000000' ? '111111' : '000000', meta)).rejects.toThrow('otp_wrong');
    const session = await verifyOtp(res, code, meta);
    res = (await resolveToken(t1))!;
    expect(sessionValid(res.recipient, session)).toBe(true);
    expect(sessionValid(res.recipient, 'forged.123')).toBe(false);
    // El código es de un solo uso.
    await expect(verifyOtp(res, code, meta)).rejects.toThrow('otp_none');

    // Aislamiento: el primero no puede completar campos del segundo.
    const f2 = (await listFields(env.id)).find((f) => f.recipient_id === r2.id && f.kind === 'text')!;
    await expect(submitSigning(res, true, { consent: true, values: { [f2.id]: 'CEO' }, signature: SIG }, meta)).rejects.toThrow('field_not_yours');
    await expect(submitSigning(res, true, { consent: false, values: {}, signature: SIG }, meta)).rejects.toThrow('consent_required');
    await expect(submitSigning(res, true, { consent: true, values: {}, signature: 'data:image/png;base64,AAAA' }, meta)).rejects.toThrow('signature_required');
    expect((await submitSigning(res, true, { consent: true, values: {}, signature: SIG, signatureKind: 'typed' }, meta)).completed).toBe(false);
    // Un solo uso: el mismo link no firma dos veces.
    res = (await resolveToken(t1))!;
    expect(publicState(res, true)).toBe('done');
    await expect(submitSigning(res, true, { consent: true, values: {}, signature: SIG }, meta)).rejects.toThrow('state_done');

    // Recién ahora le llega al segundo.
    const t2 = linkFrom(mails(b).at(-1)!.text)!;
    let res2 = (await resolveToken(t2))!;
    await sendOtp(res2, meta);
    const s2 = await verifyOtp(res2, codeFrom(mails(b).at(-1)!.text)!, meta);
    res2 = (await resolveToken(t2))!;
    expect(sessionValid(res2.recipient, s2)).toBe(true);
    // Una sesión de otro destinatario no sirve acá.
    expect(sessionValid(res2.recipient, session)).toBe(false);
    await expect(submitSigning(res2, true, { consent: true, values: {}, signature: SIG }, meta)).rejects.toThrow('required_missing');
    expect((await submitSigning(res2, true, { consent: true, values: { [f2.id]: 'CEO' }, signature: SIG }, meta)).completed).toBe(true);

    const done = (await getEnvelopeRow(w.owner.ws, env.id))!;
    expect(done.status).toBe('completed');
    const final = await envelopeFile(w.owner, env.id, 'final');
    const original = await envelopeFile(w.owner, env.id, 'original');
    expect(done.final_hash).toBe(sha256Hex(final.bytes));
    expect(done.document_hash).toBe(sha256Hex(original.bytes));
    const out = await PDFDocument.load(final.bytes);
    // 2 páginas + el certificado.
    expect(out.getPageCount()).toBeGreaterThanOrEqual(3);
    // Todos reciben la copia firmada adjunta, con el hash final.
    for (const to of [a, b, w.owner.email]) {
      const last = mails(to).at(-1)!;
      expect(last.subject).toContain('Completed');
      expect(last.attachments[0]).toMatch(/-signed\.pdf$/);
      expect(last.text).toContain(done.final_hash!);
    }
  });

  it('rechazo con motivo cierra el sobre para todos', async () => {
    const { env, a } = await draft(w.owner, { order: 'parallel' });
    await sendEnvelope(w.owner, env.id);
    const r = (await resolveToken(linkFrom(mails(a).at(-1)!.text)!))!;
    await expect(declineSigning(r, false, '   ', meta)).rejects.toThrow('reason_required');
    await declineSigning(r, false, 'Wrong start date', meta);
    expect((await getEnvelopeRow(w.owner.ws, env.id))!.status).toBe('declined');
    expect(mails(w.owner.email).at(-1)!.text).toContain('Wrong start date');
  });

  it('vencimiento y revocación del link', async () => {
    const { env, a } = await draft(w.owner);
    await sendEnvelope(w.owner, env.id);
    const old = linkFrom(mails(a).at(-1)!.text)!;
    await remindEnvelope(w.owner, env.id, { rotate: true });
    expect(await resolveToken(old)).toBeNull();
    const fresh = linkFrom(mails(a).at(-1)!.text)!;
    expect(fresh).not.toBe(old);
    expect(await resolveToken(fresh)).not.toBeNull();
    await getDb().prepare('UPDATE sign_envelopes SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', env.id);
    const r = (await resolveToken(fresh))!;
    expect(r.env.status).toBe('expired');
    expect(publicState(r, true)).toBe('expired');
    // El cron vence los demás (con claim: dos corridas no duplican).
    const other = await draft(w.owner);
    await sendEnvelope(w.owner, other.env.id);
    await getDb().prepare('UPDATE sign_envelopes SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', other.env.id);
    const [c1, c2] = await Promise.all([runSignCron(), runSignCron()]);
    expect(c1.expired + c2.expired).toBeGreaterThanOrEqual(1);
    expect((await getEnvelopeRow(w.owner.ws, other.env.id))!.status).toBe('expired');
  });

  it('permisos: otro miembro no ve ni gestiona; un destinatario del workspace lo ve', async () => {
    const { env } = await draft(w.member);
    await expect(requireSee(w.other, env.id)).rejects.toThrow('not_found');
    expect((await listEnvelopes(w.other)).some((e) => e.id === env.id)).toBe(false);
    expect((await listEnvelopes(w.owner)).some((e) => e.id === env.id)).toBe(true);
    await saveRecipients(w.member, env.id, [{ role: 'signer', name: 'Other', email: w.other.email, routingOrder: 1 }]);
    const seen = await requireSee(w.other, env.id);
    expect(seen.env.id).toBe(env.id);
    await expect(sendEnvelope(w.other, env.id)).rejects.toThrow('forbidden');
    await expect(envelopeFile({ ...w.other, ws: 'another-ws' }, env.id, 'original')).rejects.toThrow('not_found');
  });

  it('plantillas y envío masivo', async () => {
    const tp = await createTemplate(w.owner, { name: `NDA ${uid()}` });
    await setTemplateDocument(w.owner, tp.id, { bytes: await pdf(1), name: 'nda.pdf' });
    await updateTemplate(w.owner, tp.id, {
      roles: [
        { key: 'client', name: 'Client', role: 'signer', order: 1 },
        { key: 'us', name: 'Company', role: 'signer', order: 2 },
      ],
      fields: [
        { roleKey: 'client', kind: 'signature', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
        { roleKey: 'us', kind: 'signature', page: 1, x: 0.6, y: 0.8, w: 0.3, h: 0.06 },
      ],
    });
    await expect(envelopeFromTemplate(w.owner, tp.id, { recipients: { client: { name: 'X', email: 'x@example.com' } } })).rejects.toThrow('role_unfilled');
    const env = await envelopeFromTemplate(w.owner, tp.id, { recipients: { client: { name: 'X', email: 'x@example.com' }, us: { name: 'Y', email: 'y@example.com' } }, send: true });
    expect(env.status).toBe('sent');
    const res = await bulkSend(w.owner, tp.id, { csv: 'name,email\nAna,ana@example.com\nBad,not-an-email\nBruno,bruno@example.com\n', fixed: { us: { name: 'Y', email: 'y@example.com' } } });
    expect(res.sent).toBe(2);
    expect(res.errors).toEqual([{ row: 3, error: 'invalid_row' }]);
    const bulk = (await getDb().prepare('SELECT COUNT(*) AS n FROM sign_envelopes WHERE bulk_id = ?').get(res.bulkId)) as { n: number };
    expect(Number(bulk.n)).toBe(2);
  });

  it('la firma compartida con el CRM valida JPEG por sus bytes', () => {
    expect(cleanSignatureImage(SIG)).toBe(SIG);
    expect(cleanSignatureImage('data:image/png;base64,AAAA')).toBe('');
  });
});
