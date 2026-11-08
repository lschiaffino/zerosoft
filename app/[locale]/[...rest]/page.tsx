import { notFound } from 'next/navigation';

// Cualquier ruta con idioma que no existe cae acá y muestra el 404 localizado
// de app/[locale]/not-found.tsx (con header y footer del sitio).
// Dinámica: cada URL inventada sería si no una entrada nueva en el caché del CDN (con el sitio
// estático, por un año). El 404 sale sin caché.
export const dynamic = 'force-dynamic';

export default function CatchAll() {
  notFound();
}
