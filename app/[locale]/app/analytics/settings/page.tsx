import { redirect } from 'next/navigation';

/** Los ajustes de Analytics son sus fuentes de datos (bases, permisos de SQL). */
export default async function Page(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/app/analytics/data`);
}
