import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { dictationStats, getVoiceSettings, listSessions, voiceOwner } from '@/lib/voice';
import { transcriptionConfigured } from '@/lib/voice-transcribe';
import { voiceAiAvailable } from '@/lib/voice-ai';
import DictationPage from '@/components/voice/DictationPage';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'voice' });
  return { title: t('meta.dictation') };
}

export default async function VoiceDictationPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale, `/${locale}/app/voice/dictation`);
  const owner = voiceOwner(user);
  const [history, stats, settings, ai] = await Promise.all([
    listSessions(owner, { kind: 'dictation', limit: 100 }),
    dictationStats(owner),
    getVoiceSettings(owner),
    voiceAiAvailable(),
  ]);
  return <DictationPage initialHistory={history} stats={stats} shortcut={settings.shortcut} transcription={transcriptionConfigured()} ai={ai && settings.aiCleanup} />;
}
