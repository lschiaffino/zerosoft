/**
 * Books: tipos, errores y utilidades compartidas (sin DB).
 */
import { randomBytes } from 'crypto';
import type { BooksRole } from './books-roles';

export class BooksError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** Quién actúa: workspace (owner), persona real, si es admin del workspace y su rol en Books. */
export interface BooksActor {
  ws: string;
  person: string;
  admin: boolean;
  role: BooksRole;
}

export type DocType = 'invoice' | 'credit_note' | 'bill';
export const DOC_TYPES: readonly DocType[] = ['invoice', 'credit_note', 'bill'];

/** draft → sent (emitida) → partial → paid; overdue (vencida sin cobrar); void (anulada). */
export type DocStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'void';
export const DOC_STATUSES: readonly DocStatus[] = ['draft', 'sent', 'partial', 'paid', 'overdue', 'void'];
/** Estados con saldo a cobrar o pagar. */
export const OPEN_STATUSES: readonly DocStatus[] = ['sent', 'partial', 'overdue'];

export type ContactKind = 'customer' | 'supplier' | 'both';
export const CONTACT_KINDS: readonly ContactKind[] = ['customer', 'supplier', 'both'];

export type PaymentMethod = 'bank' | 'cash' | 'card' | 'stripe' | 'mercadopago' | 'other';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['bank', 'cash', 'card', 'stripe', 'mercadopago', 'other'];

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export const FREQUENCIES: readonly Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

export function nowDb(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function clean(s: unknown, max = 200): string {
  return typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';
}

export function likeEsc(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** "A 0001-00000012" (AR), "F-0001-000012" en el resto. */
export function numberLabel(docType: DocType, letter: string, pos: number, n: number, country: string): string {
  if (country === 'AR') return `${letter ? `${letter} ` : ''}${String(pos).padStart(5, '0')}-${String(n).padStart(8, '0')}`;
  const prefix = docType === 'credit_note' ? 'NC' : docType === 'bill' ? 'B' : 'F';
  return `${prefix}${letter ? letter : ''}-${String(pos).padStart(4, '0')}-${String(n).padStart(6, '0')}`;
}
