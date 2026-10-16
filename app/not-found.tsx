import Link from 'next/link';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import ZeroField from '@/components/ZeroField';

const sans = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

// 404 global (rutas fuera de /[locale]). Autocontenida: trae su propio html/body y las fuentes del sitio.
export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <div className="notfound-page">
          <ZeroField align="center" sizeFactor={1.2} interactive={false} alpha={0.12} />
          <p className="notfound-code">404</p>
          <p className="notfound-msg">This page is not here. Maybe it never was.</p>
          <Link className="btn btn-solid" href="/">
            Back to zero
          </Link>
        </div>
      </body>
    </html>
  );
}
