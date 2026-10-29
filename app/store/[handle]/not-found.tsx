import Link from 'next/link';

/** 404 de la tienda (producto o página que no existe, o tienda sin publicar). */
export default function StoreNotFound() {
  return (
    <section className="sf-section sf-narrow sf-empty">
      <h1 className="sf-h1">404</h1>
      <p className="sf-muted">This page is not available. · Esta página no está disponible. · Esta página não está disponível.</p>
      <Link className="sf-btn" href="/">
        zerosoft
      </Link>
    </section>
  );
}
