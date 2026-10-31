import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isAppSection, sectionTakesId } from '@/lib/app-sections';
import { requireUser } from '@/lib/session';
import { actorOf } from '@/lib/shop-http';
import { getCollection, getCustomer, getDiscount, getProduct } from '@/lib/shop';
import { getOrder } from '@/lib/shop-orders';

/** Arriba de loading.tsx: una sección o un registro desconocido responde 404 y no 200 (ver lib/app-sections.ts). */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string; zs?: string[] }> }) {
  const { locale, zs = [] } = await props.params;
  const [section, id, sub] = zs;
  if (zs.length > 3 || !isAppSection('shop', section) || !sectionTakesId('shop', section, id)) notFound();
  if (sub && !(section === 'orders' && sub === 'packing-slip')) notFound();
  if (id === 'new' && !['products', 'collections', 'discounts'].includes(section ?? '')) notFound();
  if (section && id && id !== 'new') {
    const user = await requireUser(locale);
    const { ws } = actorOf(user);
    if (section === 'orders' && !(await getOrder(ws, id))) notFound();
    else if (section === 'products' && !(await getProduct(ws, id))) notFound();
    else if (section === 'collections' && !(await getCollection(ws, id))) notFound();
    else if (section === 'customers' && !(await getCustomer(ws, id))) notFound();
    else if (section === 'discounts' && !(await getDiscount(ws, id))) notFound();
  }
  return props.children;
}
