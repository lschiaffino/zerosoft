import Link from 'next/link';
import ZeroField from '@/components/ZeroField';

// 404 global (rutas fuera de /[locale]). Autocontenida: trae su propio html/body.
export default function GlobalNotFound() {
  return (
    <html lang="en">
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
