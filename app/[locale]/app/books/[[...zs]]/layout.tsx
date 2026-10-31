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

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id] = zs;
  if (!isAppSection('books', section) || !sectionTakesId('books', section, id)) notFound();
  if (section && id && id !== 'new') {
    const user = await requireUser(locale);
    const ws = user.id;
    if (section === 'banking' && !(await listBankAccounts(ws, { includeArchived: true })).some((b) => b.id === id)) notFound();
    if (section === 'invoices' && !(await getDocument(ws, id))) notFound();
    else if (section === 'credit-notes' && !(await getDocument(ws, id))) notFound();
    else if (section === 'bills' && !(await getDocument(ws, id))) notFound();
    else if (section === 'recurring' && !(await getRecurring(ws, id))) notFound();
    else if (section === 'contacts' && !(await getContact(ws, id))) notFound();
    else if (section === 'items' && !(await getItem(ws, id))) notFound();
    else if (section === 'expenses' && !(await getExpense(ws, id))) notFound();
    else if (section === 'purchase-orders' && !(await getPurchaseOrder(ws, id))) notFound();
    else if (section === 'journal' && !(await getJournal(ws, id))) notFound();
  }
  return props.children;
}
