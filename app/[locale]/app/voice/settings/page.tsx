import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getVoiceSettings, listCustomTemplates, listDictionary, voiceOwner } from '@/lib/voice';
import { transcribeModel, transcribeProvider } from '@/lib/voice-transcribe';
import { BUILTIN_TEMPLATE_SECTIONS } from '@/lib/voice-templates';
import { API_BASE_URL } from '@/lib/api-docs';
import { getWorkspaceSettings, listPrompts } from '@/lib/voice-library';
import VoiceSettingsView from '@/components/voice/VoiceSettingsView';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'voice' });
  return { title: t('meta.settings') };
}

export default async function VoiceSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale, `/${locale}/app/voice/settings`);
  const owner = voiceOwner(user);
  const [settings, dictionary, templates, recipes, transforms, workspace] = await Promise.all([
    getVoiceSettings(owner),
    listDictionary(owner),
    listCustomTemplates(owner),
    listPrompts(owner, 'recipe'),
    listPrompts(owner, 'transform'),
    getWorkspaceSettings(owner.workspaceId),
  ]);
  const provider = transcribeProvider();
  return (
    <VoiceSettingsView
      settings={settings}
      dictionary={dictionary}
      templates={templates}
      recipes={recipes}
      transforms={transforms}
      workspace={workspace}
      isAdmin={isWorkspaceAdmin(user)}
      builtinSections={BUILTIN_TEMPLATE_SECTIONS}
      provider={`${provider} (${transcribeModel(provider)})`}
      apiBase={process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL.replace(/\/$/, '')}/api/v1` : API_BASE_URL}
    />
  );
}
