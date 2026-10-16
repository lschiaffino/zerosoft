import { permanentRedirect } from 'next/navigation';
import { isProductKey } from '@/lib/product-taxonomy';

/**
 * El formulario viejo de feedback pasa al board: ?product=crm abre "Proponer
 * idea" con el producto elegido. Los bugs y mensajes privados van por el
 * launcher de feedback (pestaña Enviar).
 */
export default async function FeedbackRedirect(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const { locale } = await props.params;
  const { product } = await props.searchParams;
  permanentRedirect(
    isProductKey(product) ? `/${locale}/feedback-board/new?product=${product}` : `/${locale}/feedback-board`,
  );
}
