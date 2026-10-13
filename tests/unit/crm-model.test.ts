import { describe, expect, it } from 'vitest';
import {
  createCompany,
  createContact,
  createDeal,
  createPipeline,
  createStage,
  deleteCompany,
  getCompany,
  getContact,
  getDeal,
  listCompanies,
  listContacts,
  listDeals,
  mergeContacts,
  updateCompany,
  updateContact,
  updateDeal,
  updateStage,
} from '@/lib/crm';
import {
  associate,
  associateContactCompany,
  associateDealCompany,
  dissociate,
  listAssociations,
  removeContactCompany,
  setParentCompany,
} from '@/lib/crm-assoc';
import { applyTag, createTag, deleteTag, listTags, setRecordTags, tagsForRecords } from '@/lib/crm-tags';
import {
  baseAmountSql,
  getCurrencyContext,
  missingRates,
  setExchangeRate,
  updateCrmSettings,
} from '@/lib/crm-currency';
import { convertAmount, currencyDigits, lineTotals, roundMoney, sumLines, toBase } from '@/lib/crm-money';
import {
  acceptQuote,
  addLineItem,
  createProduct,
  createQuote,
  declineQuote,
  deleteLineItem,
  getPublicQuote,
  getQuote,
  listLineItems,
  markQuoteSent,
  updateLineItem,
  updateQuote,
} from '@/lib/crm-products';
import { createWorkflow, listWorkflowRuns } from '@/lib/crm-workflows';
import { listNotifications } from '@/lib/notifications';
import { CrmRefError } from '@/lib/crm-refs';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

async function pipelineFor(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const open = await createStage(userId, p.id, { name: 'New' });
  const won = await createStage(userId, p.id, { name: 'Won', probability: 100 });
  await updateStage(userId, won!.id, { isWon: true });
  return { pipelineId: p.id, stageId: open!.id, wonStageId: won!.id };
}

async function dealFor(userId: string, extra: Parameters<typeof createDeal>[1] | object = {}) {
  const { pipelineId, stageId, wonStageId } = await pipelineFor(userId);
  const res = await createDeal(userId, { name: 'Deal', pipelineId, stageId, ...extra });
  if (!res.ok) throw new Error(res.reason);
  return { deal: res.deal, pipelineId, stageId, wonStageId };
}

function companyIdOf(contactId: string) {
  return getDb().prepare('SELECT company_id FROM crm_contacts WHERE id = ?').get(contactId) as Promise<{
    company_id: string | null;
  }>;
}

describe('CRM modelo: asociaciones contact ↔ company', () => {
  it('migración 022: el company_id existente queda como asociación primaria', async () => {
    const u = await makeUser('mig');
    const co = await createCompany(u.id, { name: 'Acme' });
    const c = await createContact(u.id, { email: 'a@acme.test', companyId: co.id });
    const row = (await getDb()
      .prepare('SELECT is_primary FROM crm_contact_companies WHERE contact_id = ? AND company_id = ?')
      .get(c.id, co.id)) as { is_primary: number };
    expect(row.is_primary).toBe(1);
    expect(c.company_id).toBe(co.id);
  });

  it('muchas empresas con label; company_id espeja siempre a la primaria', async () => {
    const u = await makeUser('cc');
    const a = await createCompany(u.id, { name: 'A' });
    const b = await createCompany(u.id, { name: 'B' });
    const c = await createContact(u.id, { email: 'x@x.test', companyId: a.id });

    await associateContactCompany(u.id, c.id, b.id, { label: 'billing' });
    let detail = await getContact(u.id, c.id);
    expect(detail?.companies.map((x) => [x.name, x.is_primary, x.label])).toEqual([
      ['A', 1, ''],
      ['B', 0, 'billing'],
    ]);
    expect((await companyIdOf(c.id)).company_id).toBe(a.id);

    // Cambiar la primaria: la anterior sigue asociada.
    await associateContactCompany(u.id, c.id, b.id, { primary: true });
    expect((await companyIdOf(c.id)).company_id).toBe(b.id);
    detail = await getContact(u.id, c.id);
    expect(detail?.company?.id).toBe(b.id);
    expect(detail?.companies).toHaveLength(2);

    // Quitar la primaria promueve la que queda.
    await removeContactCompany(u.id, c.id, b.id);
    expect((await companyIdOf(c.id)).company_id).toBe(a.id);
    await removeContactCompany(u.id, c.id, a.id);
    expect((await companyIdOf(c.id)).company_id).toBeNull();
  });

  it('companyId en updateContact (compat) asocia como primaria; null quita la primaria', async () => {
    const u = await makeUser('compat');
    const a = await createCompany(u.id, { name: 'A' });
    const b = await createCompany(u.id, { name: 'B' });
    const c = await createContact(u.id, { email: 'y@y.test' });
    await updateContact(u.id, c.id, { companyId: a.id });
    await updateContact(u.id, c.id, { companyId: b.id });
    const companies = (await getContact(u.id, c.id))!.companies;
    expect(companies.map((x) => x.name)).toEqual(['B', 'A']);
    const after = await updateContact(u.id, c.id, { companyId: null });
    // Se va B (la primaria) y A pasa a ser la primaria.
    expect(after?.company_id).toBe(a.id);
    const company = await getCompany(u.id, a.id);
    expect(company?.contacts.map((x) => [x.id, x.is_primary])).toEqual([[c.id, 1]]);
  });

  it('auto-link por dominio crea la asociación primaria', async () => {
    const u = await makeUser('dom');
    const co = await createCompany(u.id, { name: 'Kallpa', domain: 'kallpa.co' });
    const c = await createContact(u.id, { email: 'ana@kallpa.co' });
    expect(c.company_id).toBe(co.id);
    expect((await listContacts(u.id, { companyId: co.id })).total).toBe(1);
    expect((await listCompanies(u.id, { q: 'Kallpa' })).rows[0].contact_count).toBe(1);
  });

  it('no asocia registros de otro workspace', async () => {
    const a = await makeUser('iso-a');
    const b = await makeUser('iso-b');
    const mine = await createContact(a.id, { email: 'm@a.test' });
    const foreignCo = await createCompany(b.id, { name: 'Ajena' });
    const foreignContact = await createContact(b.id, { email: 't@b.test' });
    await expect(associateContactCompany(a.id, mine.id, foreignCo.id)).rejects.toThrow('invalid_company');
    await expect(
      associate(a.id, { fromType: 'company', fromId: foreignCo.id, toType: 'contact', toId: mine.id }),
    ).rejects.toBeInstanceOf(CrmRefError);
    // B no puede tocar las asociaciones de A ni leerlas.
    const myCo = await createCompany(a.id, { name: 'Mía' });
    await associateContactCompany(a.id, mine.id, myCo.id);
    expect(await removeContactCompany(b.id, mine.id, myCo.id)).toBe(false);
    expect(await listAssociations(b.id, 'contact', mine.id)).toBeNull();
    await expect(associateContactCompany(b.id, foreignContact.id, myCo.id)).rejects.toThrow('invalid_company');
    await expect(associateContactCompany(a.id, mine.id, myCo.id, { label: 'nope' })).rejects.toThrow('invalid_label');
  });

  it('merge de contactos conserva las empresas y los tags del descartado', async () => {
    const u = await makeUser('merge');
    const a = await createCompany(u.id, { name: 'A' });
    const b = await createCompany(u.id, { name: 'B' });
    const keep = await createContact(u.id, { email: 'k@x.test' });
    const drop = await createContact(u.id, { email: 'k2@x.test', companyId: a.id });
    await associateContactCompany(u.id, drop.id, b.id, { label: 'billing' });
    const tag = await createTag(u.id, { name: 'VIP' });
    if (!tag.ok) throw new Error();
    await applyTag(u.id, tag.tag.id, 'contact', [drop.id], 'add');
    const merged = await mergeContacts(u.id, keep.id, drop.id);
    expect(merged?.company_id).toBe(a.id);
    expect((await getContact(u.id, keep.id))?.companies).toHaveLength(2);
    expect((await tagsForRecords(u.id, 'contact', [keep.id])).get(keep.id)?.map((t) => t.name)).toEqual(['VIP']);
  });
});

describe('CRM modelo: asociaciones deal ↔ company', () => {
  it('companyId = primaria; los contactos traen su empresa; listar desde la empresa', async () => {
    const u = await makeUser('dc');
    const a = await createCompany(u.id, { name: 'A' });
    const b = await createCompany(u.id, { name: 'B' });
    const contact = await createContact(u.id, { email: 'c@b.test', companyId: b.id });
    const { deal } = await dealFor(u.id, { companyId: a.id, contactIds: [contact.id] });
    const detail = await getDeal(u.id, deal.id);
    expect(detail?.company?.id).toBe(a.id);
    expect(detail?.companies.map((c) => [c.name, c.is_primary])).toEqual([
      ['A', 1],
      ['B', 0],
    ]);
    expect((await getCompany(u.id, b.id))?.deals.map((d) => d.id)).toEqual([deal.id]);

    await associateDealCompany(u.id, deal.id, b.id, { primary: true });
    expect((await getDeal(u.id, deal.id))?.company?.id).toBe(b.id);
    await dissociate(u.id, { fromType: 'company', fromId: b.id, toType: 'deal', toId: deal.id });
    expect((await getDeal(u.id, deal.id))?.company?.id).toBe(a.id);
    const { rows } = await listDeals(u.id, { pipelineId: deal.pipeline_id, companyId: a.id });
    expect(rows.map((r) => [r.id, r.company_name])).toEqual([[deal.id, 'A']]);
  });

  it('borrar una empresa re-elige primarias y suelta a las hijas', async () => {
    const u = await makeUser('del');
    const a = await createCompany(u.id, { name: 'A' });
    const b = await createCompany(u.id, { name: 'B' });
    const child = await createCompany(u.id, { name: 'Hija', parentCompanyId: a.id });
    const c = await createContact(u.id, { email: 'd@d.test', companyId: a.id });
    await associateContactCompany(u.id, c.id, b.id);
    const { deal } = await dealFor(u.id, { companyId: a.id, companyIds: [b.id] });
    expect(await deleteCompany(u.id, a.id)).toBe(true);
    expect((await companyIdOf(c.id)).company_id).toBe(b.id);
    expect((await getDeal(u.id, deal.id))?.company?.id).toBe(b.id);
    expect((await getCompany(u.id, child.id))?.company.parent_company_id).toBeNull();
  });

  it('deal ↔ company rechaza empresas ajenas', async () => {
    const a = await makeUser('dca');
    const b = await makeUser('dcb');
    const foreign = await createCompany(b.id, { name: 'X' });
    const { pipelineId, stageId } = await pipelineFor(a.id);
    await expect(createDeal(a.id, { name: 'D', pipelineId, stageId, companyId: foreign.id })).rejects.toThrow(
      'invalid_company',
    );
  });
});

describe('CRM modelo: jerarquía de empresas', () => {
  it('impide ciclos (ella misma, hija o nieta como madre)', async () => {
    const u = await makeUser('tree');
    const root = await createCompany(u.id, { name: 'Holding' });
    const mid = await createCompany(u.id, { name: 'Filial', parentCompanyId: root.id });
    const leaf = await createCompany(u.id, { name: 'Sucursal', parentCompanyId: mid.id });
    await expect(setParentCompany(u.id, root.id, root.id)).rejects.toThrow('hierarchy_cycle');
    await expect(setParentCompany(u.id, root.id, leaf.id)).rejects.toThrow('hierarchy_cycle');
    await expect(updateCompany(u.id, mid.id, { parentCompanyId: leaf.id })).rejects.toThrow('hierarchy_cycle');
    // Un ciclo no deja cambios a medias.
    expect((await getCompany(u.id, mid.id))?.company.parent_company_id).toBe(root.id);
    const detail = await getCompany(u.id, leaf.id);
    expect(detail?.ancestors.map((x) => x.name)).toEqual(['Filial', 'Holding']);
    expect((await getCompany(u.id, root.id))?.children.map((x) => x.name)).toEqual(['Filial']);
    // Mover a raíz.
    await updateCompany(u.id, mid.id, { parentCompanyId: null });
    expect((await getCompany(u.id, mid.id))?.parent).toBeNull();
  });

  it('no acepta una madre de otro workspace', async () => {
    const a = await makeUser('ha');
    const b = await makeUser('hb');
    const mine = await createCompany(a.id, { name: 'Mía' });
    const theirs = await createCompany(b.id, { name: 'Ajena' });
    await expect(setParentCompany(a.id, mine.id, theirs.id)).rejects.toThrow('invalid_company');
  });

  it('valor de deals acumulado del árbol, en moneda base', async () => {
    const u = await makeUser('roll');
    await updateCrmSettings(u.id, { baseCurrency: 'USD' });
    await setExchangeRate(u.id, 'EUR', 1.1);
    const root = await createCompany(u.id, { name: 'Holding' });
    const child = await createCompany(u.id, { name: 'Filial', parentCompanyId: root.id });
    const grandchild = await createCompany(u.id, { name: 'Sucursal', parentCompanyId: child.id });
    const { pipelineId, stageId, wonStageId } = await pipelineFor(u.id);
    await createDeal(u.id, { name: 'R', pipelineId, stageId, amount: 100, currency: 'USD', companyId: root.id });
    await createDeal(u.id, { name: 'C', pipelineId, stageId: wonStageId, amount: 1000, currency: 'EUR', companyId: child.id });
    // Un deal asociado a dos empresas del árbol se cuenta una sola vez.
    await createDeal(u.id, {
      name: 'G',
      pipelineId,
      stageId,
      amount: 50,
      currency: 'USD',
      companyId: grandchild.id,
      companyIds: [root.id],
    });
    const detail = await getCompany(u.id, root.id);
    expect(detail?.rollup.currency).toBe('USD');
    expect(detail?.rollup.own).toEqual({ open: 150, won: 0, count: 2 });
    expect(detail?.rollup.total.count).toBe(3);
    expect(detail?.rollup.total.open).toBe(150);
    expect(detail?.rollup.total.won).toBeCloseTo(1100);
    expect(detail?.rollup.childCount).toBe(2);
  });
});

describe('CRM modelo: dinero (line items)', () => {
  it('descuento, impuesto y redondeo por línea', () => {
    expect(lineTotals({ quantity: 3, unit_price: 19.99, discount_pct: 10, tax_pct: 21 })).toEqual({
      subtotal: 59.97,
      discount: 6,
      net: 53.97,
      tax: 11.33,
      total: 65.3,
    });
    // 1.005 redondea hacia arriba (sin el error de float de 1.005 * 100).
    expect(roundMoney(1.005, 'USD')).toBe(1.01);
    expect(roundMoney(-2.345, 'USD')).toBe(-2.35);
    // Monedas sin decimales.
    expect(currencyDigits('JPY')).toBe(0);
    expect(lineTotals({ quantity: 1, unit_price: 1999, discount_pct: 15, tax_pct: 10 }, 'JPY')).toEqual({
      subtotal: 1999,
      discount: 300,
      net: 1699,
      tax: 170,
      total: 1869,
    });
    const totals = sumLines(
      [
        { quantity: 1, unit_price: 0.1, discount_pct: 0, tax_pct: 0 },
        { quantity: 1, unit_price: 0.2, discount_pct: 0, tax_pct: 0 },
      ],
      'USD',
    );
    expect(totals.total).toBe(0.3);
    // Porcentajes fuera de rango se acotan.
    expect(lineTotals({ quantity: 1, unit_price: 10, discount_pct: 150, tax_pct: -5 }).total).toBe(0);
  });

  it('conversión entre monedas vía la base', () => {
    const ctx = { base: 'USD', rates: { EUR: 1.1, ARS: 0.001 } };
    expect(convertAmount(100, 'EUR', 'USD', ctx)).toBe(110);
    expect(convertAmount(110, 'USD', 'EUR', ctx)).toBe(100);
    expect(convertAmount(1000, 'EUR', 'ARS', ctx)).toBe(1100000);
    expect(convertAmount(1, 'GBP', 'USD', ctx)).toBeNull();
    expect(toBase(5, 'GBP', ctx)).toBe(5);
  });

  it('el amount del deal se calcula desde los line items salvo override', async () => {
    const u = await makeUser('li');
    const product = await createProduct(u.id, { name: 'Pro', price: 100, currency: 'USD', taxPct: 21, recurring: 'monthly' });
    const { deal } = await dealFor(u.id, { amount: 5, currency: 'USD' });
    const item = await addLineItem(u.id, deal.id, { productId: product.id, quantity: 3, discountPct: 10 });
    expect(item).toMatchObject({ name: 'Pro', unit_price: 100, tax_pct: 21, recurring: 'monthly', net: 270, total: 326.7 });
    await addLineItem(u.id, deal.id, { name: 'Setup', unitPrice: 49.995 });
    let summary = await listLineItems(u.id, deal.id);
    expect(summary?.totals).toEqual({ subtotal: 350, discount: 30, net: 320, tax: 56.7, total: 376.7 });
    expect((await getDeal(u.id, deal.id))?.deal.amount).toBe(320);

    // Editar el amount a mano lo fija.
    await updateDeal(u.id, deal.id, { amount: 999 });
    await updateLineItem(u.id, deal.id, item.id, { quantity: 1 });
    expect((await getDeal(u.id, deal.id))?.deal).toMatchObject({ amount: 999, amount_override: 1 });
    // Volver al cálculo.
    await updateDeal(u.id, deal.id, { amountOverride: false });
    expect((await getDeal(u.id, deal.id))?.deal.amount).toBe(140);
    await deleteLineItem(u.id, deal.id, item.id);
    summary = await listLineItems(u.id, deal.id);
    expect(summary?.items).toHaveLength(1);
    expect((await getDeal(u.id, deal.id))?.deal.amount).toBe(50);
  });

  it('el precio del producto se convierte a la moneda del deal', async () => {
    const u = await makeUser('fx');
    await setExchangeRate(u.id, 'EUR', 1.25);
    const product = await createProduct(u.id, { name: 'Plan EU', price: 80, currency: 'EUR' });
    const { deal } = await dealFor(u.id, { currency: 'usd' });
    expect(deal.currency).toBe('USD');
    const item = await addLineItem(u.id, deal.id, { productId: product.id });
    expect(item.unit_price).toBe(100);
  });

  it('line items: productos y deals de otro workspace no valen', async () => {
    const a = await makeUser('lia');
    const b = await makeUser('lib');
    const foreignProduct = await createProduct(b.id, { name: 'X', price: 1 });
    const { deal } = await dealFor(a.id);
    await expect(addLineItem(a.id, deal.id, { productId: foreignProduct.id })).rejects.toThrow('invalid_product');
    await expect(addLineItem(b.id, deal.id, { name: 'Y' })).rejects.toThrow('invalid_deal');
    await expect(addLineItem(a.id, deal.id, { name: '  ' })).rejects.toThrow('missing_name');
  });
});

describe('CRM modelo: quotes', () => {
  async function quoteFor(userId: string, opts: { expiresAt?: string | null } = {}) {
    const ctx = await dealFor(userId, { currency: 'USD' });
    await addLineItem(userId, ctx.deal.id, { name: 'Pro', unitPrice: 100, quantity: 2, taxPct: 10 });
    const res = await createQuote(userId, ctx.deal.id, { terms: 'Net 30', ...opts }, userId);
    if (!res.ok) throw new Error(res.error);
    return { ...ctx, quote: res.quote };
  }

  it('sin line items no se crea; snapshot de los items al crearlo', async () => {
    const u = await makeUser('q0');
    const { deal } = await dealFor(u.id);
    expect(await createQuote(u.id, deal.id, {})).toEqual({ ok: false, error: 'no_line_items' });
    const { quote, deal: d2 } = await quoteFor(u.id);
    expect(quote).toMatchObject({ status: 'draft', subtotal: 200, tax_total: 20, total: 220, currency: 'USD' });
    expect(quote.number).toMatch(/^Q-\d{4}-\d{4}$/);
    expect(quote.parsed_items).toHaveLength(1);
    // Cambiar los line items después no cambia el quote…
    await addLineItem(u.id, d2.id, { name: 'Extra', unitPrice: 50 });
    expect((await getQuote(u.id, quote.id))?.total).toBe(220);
    // …salvo refresh (solo borradores).
    const refreshed = await updateQuote(u.id, quote.id, { refreshItems: true });
    expect(refreshed.ok && refreshed.quote.total).toBe(270);
  });

  it('el borrador no es público; enviado se acepta con nombre + checkbox', async () => {
    const u = await makeUser('q1');
    const { quote, deal, wonStageId } = await quoteFor(u.id);
    await updateCrmSettings(u.id, { quoteAcceptMovesDeal: true });
    const wf = await createWorkflow(u.id, {
      name: 'Quote aceptado',
      enabled: true,
      triggers: [{ type: 'quote_accepted' }],
      actions: [{ type: 'notify_user', config: { message: 'Aceptado {{deal.name}}' } }],
    });
    expect(await getPublicQuote(quote.token)).toBeNull();
    expect(await acceptQuote(quote.token, { name: 'Ana', agree: true, ip: '1.2.3.4' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    const sent = await markQuoteSent(u.id, quote.id);
    expect(sent.ok).toBe(true);
    expect((await getPublicQuote(quote.token))?.status).toBe('sent');
    expect(await updateQuote(u.id, quote.id, { notes: 'x' })).toEqual({ ok: false, error: 'not_draft' });

    expect(await acceptQuote(quote.token, { name: '  ', agree: true, ip: '1.2.3.4' })).toEqual({
      ok: false,
      error: 'invalid_signature',
    });
    expect(await acceptQuote(quote.token, { name: 'Ana', agree: false, ip: '1.2.3.4' })).toEqual({
      ok: false,
      error: 'invalid_signature',
    });
    const res = await acceptQuote(quote.token, { name: 'Ana Garcia', agree: true, ip: '1.2.3.4' });
    expect(res.ok && res.quote.status).toBe('accepted');
    const stored = await getQuote(u.id, quote.id);
    expect(stored?.signer_name).toBe('Ana Garcia');
    expect(stored?.signer_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.signer_ip_hash).not.toContain('1.2.3.4');
    expect(stored?.accepted_at).toBeTruthy();
    // No se acepta dos veces ni se rechaza después.
    expect(await acceptQuote(quote.token, { name: 'Otro', agree: true, ip: '5.6.7.8' })).toEqual({
      ok: false,
      error: 'not_open',
    });
    expect(await declineQuote(quote.token, { ip: '5.6.7.8' })).toEqual({ ok: false, error: 'not_open' });

    // Efectos: actividad en el deal, notificación al owner, workflow y deal ganado.
    const notes = (await getDb()
      .prepare("SELECT subject FROM crm_activities WHERE deal_id = ? AND type = 'note'")
      .all(deal.id)) as Array<{ subject: string }>;
    expect(notes.some((n) => n.subject.includes('accepted by Ana Garcia'))).toBe(true);
    const notifs = await listNotifications(u.id);
    expect(notifs.some((n) => n.source_type === 'crm_quote' && n.source_id === quote.id)).toBe(true);
    expect((await listWorkflowRuns(u.id, wf.id)).length).toBeGreaterThan(0);
    expect((await getDeal(u.id, deal.id))?.deal.stage_id).toBe(wonStageId);
  });

  it('rechazo con motivo; vencido no se puede aceptar', async () => {
    const u = await makeUser('q2');
    const { quote } = await quoteFor(u.id);
    await markQuoteSent(u.id, quote.id);
    const res = await declineQuote(quote.token, { reason: 'Muy caro', ip: '9.9.9.9' });
    expect(res.ok && res.quote.status).toBe('declined');
    expect((await getQuote(u.id, quote.id))?.decline_reason).toBe('Muy caro');

    const old = await quoteFor(u.id, { expiresAt: '2020-01-01' });
    await markQuoteSent(u.id, old.quote.id);
    expect(await acceptQuote(old.quote.token, { name: 'Ana', agree: true, ip: '1.1.1.1' })).toEqual({
      ok: false,
      error: 'expired',
    });
    expect((await getQuote(u.id, old.quote.id))?.status).toBe('expired');
    expect((await getPublicQuote(old.quote.token))?.status).toBe('expired');
    // Token desconocido.
    expect(await getPublicQuote('nope')).toBeNull();
  });

  it('quotes de otro workspace no se ven ni se editan', async () => {
    const a = await makeUser('qa');
    const b = await makeUser('qb');
    const { quote } = await quoteFor(a.id);
    expect(await getQuote(b.id, quote.id)).toBeNull();
    expect(await markQuoteSent(b.id, quote.id)).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('CRM modelo: tags', () => {
  it('CRUD, nombre único sin importar mayúsculas, filtros y bulk', async () => {
    const u = await makeUser('tags');
    const other = await makeUser('tags2');
    const vip = await createTag(u.id, { name: 'VIP', color: 'cal' });
    if (!vip.ok) throw new Error();
    expect(await createTag(u.id, { name: 'vip' })).toEqual({ ok: false, error: 'duplicate_tag' });
    // Otro workspace puede usar el mismo nombre.
    expect((await createTag(other.id, { name: 'VIP' })).ok).toBe(true);
    const bad = await createTag(u.id, { name: 'Raro', color: 'fucsia' });
    expect(bad.ok && bad.tag.color).toBe('crm');

    const c1 = await createContact(u.id, { email: 't1@x.test' });
    const c2 = await createContact(u.id, { email: 't2@x.test' });
    const foreign = await createContact(other.id, { email: 't3@x.test' });
    expect(await applyTag(u.id, vip.tag.id, 'contact', [c1.id, c2.id, foreign.id], 'add')).toBe(2);
    expect(await applyTag(u.id, vip.tag.id, 'contact', [c1.id], 'add')).toBe(0);
    await expect(applyTag(other.id, vip.tag.id, 'contact', [foreign.id], 'add')).rejects.toThrow('invalid_tag');

    expect((await listContacts(u.id, { tag: vip.tag.id })).total).toBe(2);
    await applyTag(u.id, vip.tag.id, 'contact', [c2.id], 'remove');
    expect((await listContacts(u.id, { tag: vip.tag.id })).rows.map((r) => r.id)).toEqual([c1.id]);
    // Constructor avanzado: is / isnot.
    expect((await listContacts(u.id, { filters: [{ f: 'tag', o: 'isnot', v: vip.tag.id }] })).rows.map((r) => r.id)).toEqual([
      c2.id,
    ]);

    const co = await createCompany(u.id, { name: 'Co' });
    const { deal, pipelineId } = await dealFor(u.id);
    await applyTag(u.id, vip.tag.id, 'company', [co.id], 'add');
    await setRecordTags(u.id, 'deal', deal.id, [vip.tag.id]);
    expect((await listCompanies(u.id, { tag: vip.tag.id })).total).toBe(1);
    expect((await listDeals(u.id, { pipelineId, tag: vip.tag.id })).total).toBe(1);
    await expect(setRecordTags(u.id, 'deal', deal.id, [crypto.randomUUID()])).rejects.toThrow('invalid_tag');
    const counts = (await listTags(u.id)).find((t) => t.id === vip.tag.id);
    expect(counts).toMatchObject({ contacts: 1, companies: 1, deals: 1 });

    // Borrar el registro limpia sus tags (trigger); borrar el tag limpia todo.
    await getDb().prepare('DELETE FROM crm_contacts WHERE id = ?').run(c1.id);
    expect((await listTags(u.id)).find((t) => t.id === vip.tag.id)?.contacts).toBe(0);
    await deleteTag(u.id, vip.tag.id);
    const left = (await getDb().prepare('SELECT COUNT(*) AS n FROM crm_record_tags WHERE tag_id = ?').get(vip.tag.id)) as {
      n: number;
    };
    expect(left.n).toBe(0);
  });
});

describe('CRM modelo: multi-moneda', () => {
  it('rates manuales a la base; SQL de reportes convierte', async () => {
    const u = await makeUser('cur');
    await updateCrmSettings(u.id, { baseCurrency: 'eur' });
    await setExchangeRate(u.id, 'usd', 0.9);
    const ctx = await getCurrencyContext(u.id);
    expect(ctx).toEqual({ base: 'EUR', rates: { USD: 0.9 } });
    await expect(setExchangeRate(u.id, 'USD', 0)).rejects.toThrow('invalid_rate');

    const { pipelineId, stageId } = await pipelineFor(u.id);
    // Sin moneda explícita el deal usa la base del workspace.
    const d0 = await createDeal(u.id, { name: 'Base', pipelineId, stageId, amount: 10 });
    expect(d0.ok && d0.deal.currency).toBe('EUR');
    await createDeal(u.id, { name: 'USD', pipelineId, stageId, amount: 100, currency: 'USD' });
    await createDeal(u.id, { name: 'GBP', pipelineId, stageId, amount: 7, currency: 'GBP' });
    const row = (await getDb()
      .prepare(`SELECT SUM(${baseAmountSql('d')}) AS s FROM crm_deals d WHERE d.user_id = ?`)
      .get(u.id)) as { s: number };
    // 10 EUR + 100 USD × 0.9 + 7 GBP (sin rate → 1:1)
    expect(row.s).toBeCloseTo(107);
    expect(await missingRates(u.id)).toEqual(['GBP']);
    // Cambiar la base borra el rate de la nueva base (vale 1).
    await updateCrmSettings(u.id, { baseCurrency: 'USD' });
    expect((await getCurrencyContext(u.id)).rates).toEqual({});
  });
});
