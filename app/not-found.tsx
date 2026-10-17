import Link from 'next/link';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import '@/styles/site.css';

const sans = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

// 404 global (rutas fuera de /[locale]). Autocontenida: trae su propio html/body
// y las fuentes del sitio. Las rutas con idioma usan app/[locale]/not-found.tsx.
export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <main className="container">
          <header className="read-hero">
            <h1 className="read-title">This page does not exist.</h1>
            <p className="read-intro">The link may have a typo or the page moved.</p>
            <div className="read-actions">
              <Link className="btn btn-primary btn-lg" href="/">
                Go to the home page
              </Link>
            </div>
          </header>
        </main>
      </body>
    </html>
  );
}
