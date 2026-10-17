import { notFound } from 'next/navigation';

// Cualquier ruta con idioma que no existe cae acá y muestra el 404 localizado
// de app/[locale]/not-found.tsx (con header y footer del sitio).
export default function CatchAll() {
  notFound();
}
