import { NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { notionCredentialsForVoice, slackChannelsForVoice } from '@/lib/voice-send';
import { getVoiceSettings } from '@/lib/voice';
import { isWorkspaceAdmin } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A dónde se puede mandar una nota: canales públicos de la app de Slack del
 * workspace y credenciales de Notion de Flow (solo nombre e id, nunca el
 * token), más el último destino que usó la persona. Las credenciales de Flow
 * las carga un admin y escriben con su acceso a Notion: solo los admins las
 * usan desde Voice (notionAdminOnly avisa a los demás).
 */
export async function GET() {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const admin = isWorkspaceAdmin(auth.user);
  const [slack, notion, settings] = await Promise.all([
    slackChannelsForVoice(auth.owner.workspaceId).catch(() => ({ connected: false, channels: [] })),
    admin ? notionCredentialsForVoice(auth.owner.workspaceId).catch(() => []) : Promise.resolve([]),
    getVoiceSettings(auth.owner),
  ]);
  return NextResponse.json({
    slack,
    notion,
    notionAdminOnly: !admin,
    last: { slackChannel: settings.slackChannel, notionParent: settings.notionParent, notionCredentialId: settings.notionCredentialId },
  });
}
