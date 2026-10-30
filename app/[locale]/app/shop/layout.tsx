import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/shop.css';

/** Shop: pedidos, catálogo, inventario, clientes, descuentos y la tienda. */
export default async function ShopLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['shop']}>
      {props.children}
    </ClientMessages>
  );
}
