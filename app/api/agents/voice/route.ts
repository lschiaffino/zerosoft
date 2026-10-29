import { NextRequest } from 'next/server';
import { appBase, e164, fakeVoiceAllowed, readTwilioWebhook, rejectTwiml, twimlResponse } from '@/lib/twilio-voice';
import { endTwiml, gatherTwiml, speakable, VOICE_MAX_SILENCES, voiceAgentForNumber, voicePhrases } from '@/lib/agents-voice';
import { parseSettings } from '@/lib/agents-config';
import { replyOnExternal } from '@/lib/agents-channels';
import { agentsAiEnabled } from '@/lib/agents-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Voice URL de un número de Twilio asignado a un agente (Agents > Canales >
 * Teléfono). Firma de Twilio verificada (salvo el modo fake de e2e). Sin
 * ?step: saluda y escucha; step=turn: lo que dijo la persona va al agente y
 * su respuesta se lee; derivar pasa la llamada al número de derivación.
 */
export async function POST(req: NextRequest) {
  const { ok, params } = await readTwilioWebhook(req);
  if (!ok && !fakeVoiceAllowed()) return twimlResponse(rejectTwiml(), 403);
  const agent = await voiceAgentForNumber(e164(params.To) ?? '');
  if (!agent) return twimlResponse(rejectTwiml());
  const voice = parseSettings(agent.settings).voice;
  const language = voice.language;
  const phrases = voicePhrases(language);
  const base = appBase();
  const step = req.nextUrl.searchParams.get('step');
  if (!(await agentsAiEnabled())) return twimlResponse(endTwiml({ say: phrases.unavailable, language, dial: voice.handoffNumber || null }));

  if (step !== 'turn') {
    const greeting = voice.greeting || agent.welcome_message || phrases.greeting;
    return twimlResponse(gatherTwiml({ base, say: greeting, language }));
  }

  const said = (params.SpeechResult ?? '').trim();
  const silences = Number(req.nextUrl.searchParams.get('s')) || 0;
  if (!said) {
    if (silences >= VOICE_MAX_SILENCES) return twimlResponse(endTwiml({ say: phrases.bye, language }));
    return twimlResponse(gatherTwiml({ base, say: phrases.silence, language, silences: silences + 1 }));
  }
  const callSid = /^CA[0-9a-f]{32}$/i.test(params.CallSid ?? '') ? params.CallSid! : `call-${(params.From ?? '').replace(/\D/g, '').slice(-6)}`;
  const from = e164(params.From);
  const reply = await replyOnExternal({
    agent,
    source: 'voice',
    externalRef: `voice:${callSid}`,
    text: said,
    title: from ? `Call ${from.slice(0, -4).replace(/\d/g, '•')}${from.slice(-4)}` : 'Call',
  });
  if (!reply) return twimlResponse(endTwiml({ say: phrases.unavailable, language, dial: voice.handoffNumber || null }));
  // Derivada (ahora o antes): pasa a una persona por teléfono si hay número; si no, el equipo recibe el aviso.
  if (reply.handoff || reply.handedOff) {
    return twimlResponse(endTwiml({ say: speakable(reply.text), language, dial: voice.handoffNumber || null }));
  }
  const { uiAsText } = await import('@/lib/agents-ui-blocks');
  const options = reply.ui?.kind === 'buttons' ? `\n${uiAsText(reply.ui)}` : '';
  return twimlResponse(gatherTwiml({ base, say: speakable(`${reply.text}${options}`), language }));
}
