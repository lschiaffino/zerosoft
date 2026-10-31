import { NextRequest, NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { getCurrentUser } from '@/lib/session';
import { requestLocale } from '@/lib/request-locale';
import { recorderExtensionZip } from '@/lib/robots-recorder-extension';
import { recorderLabels } from '@/lib/robots-recorder';
import { unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Extensión de Chrome del grabador, en el idioma de quien la baja (.zip para "Cargar descomprimida"). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  const t = await getTranslations({ locale, namespace: 'robots.recorder' });
  const zip = recorderExtensionZip(recorderLabels((k, v) => t(k as never, v as never)), {
    title: t('extension.popupTitle'),
    code: t('extension.popupCode'),
    url: t('extension.popupUrl'),
    start: t('extension.popupStart'),
    stop: t('extension.popupStop'),
    active: t('extension.popupActive'),
    invalid: t('extension.popupInvalid'),
  });
  return new NextResponse(new Uint8Array(zip), {
    headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="zerosoft-robots-recorder.zip"' },
  });
}
