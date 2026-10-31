import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { requireUser } from '@/lib/session';
import { getContact, getItem } from '@/lib/books';
import { listBankAccounts } from '@/lib/books-bank';
import { getDocument } from '@/lib/books-docs';
import { getJournal } from '@/lib/books-ledger';
import { getExpense, getPurchaseOrder } from '@/lib/books-purchasing';
import { getRecurring } from '@/lib/books-recurring';

const DOC_KINDS: Record<string, string> = { invoices: 'invoice', 'credit-notes': 'credit_note', bills: 'bill' };
const REPORT_IDS = ['pnl', 'balance-sheet', 'cash-flow', 'aged-receivables', 'aged-payables', 'tax'];

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (zs.length > 2 || !isAppSection('books', section) || !sectionTakesId('books', section, id)) notFound();
  if (section === 'reports' && id && !REPORT_IDS.includes(id)) notFound();
  if (section && id && id !== 'new') {
    const user = await requireUser(locale);
    const ws = user.id;
    if (section === 'banking' && !(await listBankAccounts(ws, { includeArchived: true })).some((b) => b.id === id)) notFound();
    const docKind = DOC_KINDS[section];
    if (docKind) {
      const doc = await getDocument(ws, id);
      if (!doc || doc.docType !== docKind) notFound();
    } else if (section === 'recurring' && !(await getRecurring(ws, id))) notFound();
    else if (section === 'contacts' && !(await getContact(ws, id))) notFound();
    else if (section === 'items' && !(await getItem(ws, id))) notFound();
    else if (section === 'expenses' && !(await getExpense(ws, id))) notFound();
    else if (section === 'purchase-orders' && !(await getPurchaseOrder(ws, id))) notFound();
    else if (section === 'journal' && !(await getJournal(ws, id))) notFound();
  }
  return props.children;
}
