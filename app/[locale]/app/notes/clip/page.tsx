import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { pathWithQuery } from '@/lib/return-path';
import NotesClipForm from '@/components/notes/NotesClipForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'notes' });
  return { title: t('clip.button') };
}

/**
 * Destino del bookmarklet "Clip page": muestra lo recortado y lo guarda al
 * confirmar (nunca se escribe en un GET: otra web podría abrir esta URL).
 */
export default async function NotesClipPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ url?: string; title?: string; selection?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  // Sin sesión, el clip (URL, título y selección) sobrevive al login.
  await requireUser(locale, pathWithQuery(`/${locale}/app/notes/clip`, sp));
  // Compartir desde el teléfono (share_target de app/manifest.ts): muchas
  // apps mandan el link dentro del texto, no en `url`.
  const sharedText = typeof sp.selection === 'string' ? sp.selection : '';
  const fromText = sharedText.match(/https?:\/\/[^\s<>"]+/i)?.[0] ?? '';
  const rawUrl = typeof sp.url === 'string' && /^https?:\/\//i.test(sp.url) ? sp.url : fromText;
  const url = rawUrl.slice(0, 2000);
  return (
    <NotesClipForm
      url={url}
      title={typeof sp.title === 'string' ? sp.title.slice(0, 300) : ''}
      selection={(fromText && rawUrl === fromText ? sharedText.replace(fromText, '').trim() : sharedText).slice(0, 8000)}
    />
  );
}
