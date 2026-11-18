/**
 * Shop: reportes de ventas y exportaciones CSV. Las exportaciones de pedidos y
 * clientes llevan datos personales: solo admins (lo exige la ruta). Server-only.
 */
import { getDb } from './db';
import { csvCell } from './shop-csv';
import { centsToInput } from './shop-money';
import { nowDb } from './shop';

export interface ReportRow {
  key: string;
  label: string;
  orders: number;
  quantity: number;
  salesCents: number;
}

export interface ShopReports {
  days: number;
  byProduct: ReportRow[];
  byPayment: ReportRow[];
  byDiscount: ReportRow[];
  byDay: ReportRow[];
  topCustomers: ReportRow[];
}

function fromDate(days: number, now: Date): string {
  return nowDb(new Date(now.getTime() - Math.max(1, days) * 86_400_000));
}

/** Ventas ya cobradas en el período, por fecha de pago y netas de reembolsos (por pedido). */
export async function shopReports(ws: string, days = 30, now: Date = new Date()): Promise<ShopReports> {
  const span = [7, 30, 90, 365].includes(days) ? days : 30;
  const from = fromDate(span, now);
  const db = getDb();
  const paid = "o.workspace_id = ? AND o.paid_at IS NOT NULL AND o.paid_at >= ? AND o.status != 'cancelled'";
  const [products, payments, discounts, daily, customers] = (await Promise.all([
    db.prepare(`SELECT COALESCE(i.product_id, i.title) AS k, i.title AS label, COUNT(DISTINCT o.id) AS orders, SUM(i.quantity) AS qty, SUM(i.total_cents) AS sales FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id WHERE ${paid} GROUP BY k ORDER BY sales DESC LIMIT 100`).all(ws, from),
    db.prepare(`SELECT o.payment_method AS k, o.payment_method AS label, COUNT(*) AS orders, 0 AS qty, SUM(o.total_cents - o.refunded_cents) AS sales FROM shop_orders o WHERE ${paid} GROUP BY k ORDER BY sales DESC`).all(ws, from),
    db.prepare(`SELECT o.discount_code AS k, o.discount_code AS label, COUNT(*) AS orders, 0 AS qty, SUM(o.discount_cents) AS sales FROM shop_orders o WHERE ${paid} AND o.discount_code IS NOT NULL GROUP BY k ORDER BY orders DESC LIMIT 100`).all(ws, from),
    db.prepare(`SELECT substr(o.paid_at, 1, 10) AS k, substr(o.paid_at, 1, 10) AS label, COUNT(*) AS orders, 0 AS qty, SUM(o.total_cents - o.refunded_cents) AS sales FROM shop_orders o WHERE ${paid} GROUP BY k ORDER BY k DESC LIMIT 366`).all(ws, from),
    db.prepare(`SELECT o.email AS k, COALESCE(NULLIF(MAX(o.name), ''), o.email) AS label, COUNT(*) AS orders, 0 AS qty, SUM(o.total_cents - o.refunded_cents) AS sales FROM shop_orders o WHERE ${paid} GROUP BY k ORDER BY sales DESC LIMIT 50`).all(ws, from),
  ])) as Array<Array<Record<string, unknown>>>;
  const map = (rows: Array<Record<string, unknown>>): ReportRow[] => rows.map((r) => ({ key: String(r.k), label: String(r.label ?? ''), orders: Number(r.orders), quantity: Number(r.qty ?? 0), salesCents: Number(r.sales ?? 0) }));
  return { days: span, byProduct: map(products), byPayment: map(payments), byDiscount: map(discounts), byDay: map(daily), topCustomers: map(customers) };
}

function csv(header: string[], rows: unknown[][]): string {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export const EXPORT_MAX_ROWS = 20_000;

export async function exportOrdersCsv(ws: string, days: number | null, now: Date = new Date()): Promise<string> {
  const args: Array<string | number> = [ws];
  if (days) args.push(fromDate(days, now));
  const rows = (await getDb()
    .prepare(
      `SELECT o.*, (SELECT GROUP_CONCAT(i.quantity || ' x ' || i.title, ' | ') FROM shop_order_items i WHERE i.order_id = o.id) AS lines
       FROM shop_orders o WHERE o.workspace_id = ? AND o.status != 'draft' ${days ? 'AND o.created_at >= ?' : ''} ORDER BY o.created_at DESC LIMIT ${EXPORT_MAX_ROWS}`,
    )
    .all(...args)) as Array<Record<string, unknown>>;
  const money = (v: unknown) => centsToInput(Number(v ?? 0));
  return csv(
    ['Number', 'Created at (UTC)', 'Status', 'Email', 'Name', 'Phone', 'Tax ID', 'Currency', 'Subtotal', 'Discount', 'Discount code', 'Shipping', 'Shipping method', 'Tax', 'Total', 'Refunded', 'Payment method', 'Paid at (UTC)', 'Fulfilled at (UTC)', 'Tracking', 'Items'],
    rows.map((o) => [o.number, o.created_at, o.status, o.email, o.name, o.phone, o.tax_id, o.currency, money(o.subtotal_cents), money(o.discount_cents), o.discount_code, money(o.shipping_cents), o.shipping_name, money(o.tax_cents), money(o.total_cents), money(o.refunded_cents), o.payment_method, o.paid_at, o.fulfilled_at, o.tracking_number, o.lines]),
  );
}

export async function exportCustomersCsv(ws: string): Promise<string> {
  const rows = (await getDb().prepare(`SELECT * FROM shop_customers WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ${EXPORT_MAX_ROWS}`).all(ws)) as Array<Record<string, unknown>>;
  return csv(
    ['Email', 'Name', 'Phone', 'Orders', 'Total spent', 'Tags', 'Created at (UTC)'],
    rows.map((c) => [c.email, c.name, c.phone, c.orders_count, centsToInput(Number(c.total_spent_cents ?? 0)), (() => { try { return (JSON.parse(String(c.tags ?? '[]')) as string[]).join(', '); } catch { return ''; } })(), c.created_at]),
  );
}

export async function exportReportCsv(ws: string, report: 'products' | 'days' | 'payments' | 'discounts', days: number, now: Date = new Date()): Promise<string> {
  const r = await shopReports(ws, days, now);
  const data = report === 'products' ? r.byProduct : report === 'payments' ? r.byPayment : report === 'discounts' ? r.byDiscount : r.byDay;
  return csv(['Name', 'Orders', 'Units', 'Amount'], data.map((x) => [x.label, x.orders, x.quantity, centsToInput(x.salesCents)]));
}
