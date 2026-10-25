import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import SettingsSoonSection from '@/components/app/SettingsSoonSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'members');
}

/** Ajustes › Miembros. Hoy los miembros e invitaciones viven en los ajustes del CRM. */
export default async function MembersSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return <SettingsSoonSection locale={locale} section="members" />;
}
