import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import OfflineSettings from '@/components/settings/OfflineSettings';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'offline');
}

/** Ajustes › Sin conexión: el modo sin conexión de este dispositivo (vale para el navegador o la app de escritorio). */
export default async function OfflineSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  // persona:workspace, el mismo dueño que OfflineIdentity y la barra de estado.
  return <OfflineSettings owner={`${user.actingUser?.id ?? user.id}:${user.id}`} />;
}
