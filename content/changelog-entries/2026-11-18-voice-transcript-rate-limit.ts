import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-voice-transcript-rate-limit',
  date: '2026-11-18',
  title: {
    en: 'Voice: meeting transcripts no longer drop pieces when the provider is busy',
    es: 'Voice: la transcripción de una reunión ya no pierde pedazos cuando el proveedor está lleno',
    pt: 'Voice: a transcrição de uma reunião não perde mais trechos quando o provedor está cheio',
  },
  items: [
    {
      product: 'voice',
      en: 'A meeting sends a piece of audio every 20 seconds for your microphone and another for the computer audio. Transcription used a single model, which only accepts a few requests per minute, so many pieces failed and the transcript stayed empty. Now, when that model is full, the piece goes to a second transcription model (and to Groq when a key is set), and the full model is skipped for a minute. If every model is full, the recorder waits and sends the piece again instead of losing it. Voice notes in Inbox and Lines and Calls recordings use the same fallback.',
      es: 'Una reunión manda un pedazo de audio cada 20 segundos por tu micrófono y otro por el audio de la compu. La transcripción usaba un solo modelo, que acepta pocos pedidos por minuto, y muchos pedazos fallaban: la transcripción quedaba vacía. Ahora, cuando ese modelo está lleno, el pedazo va a un segundo modelo de transcripción (y a Groq si hay clave), y el modelo lleno se saltea un minuto. Si están todos llenos, el grabador espera y vuelve a mandar el pedazo en vez de perderlo. Las notas de voz de Inbox y Lines y las grabaciones de Calls usan el mismo respaldo.',
      pt: 'Uma reunião manda um trecho de áudio a cada 20 segundos pelo seu microfone e outro pelo áudio do computador. A transcrição usava um só modelo, que aceita poucos pedidos por minuto, e muitos trechos falhavam: a transcrição ficava vazia. Agora, quando esse modelo está cheio, o trecho vai para um segundo modelo de transcrição (e para a Groq se houver chave), e o modelo cheio é pulado por um minuto. Se todos estiverem cheios, o gravador espera e manda o trecho de novo em vez de perdê-lo. As notas de voz do Inbox e do Lines e as gravações do Calls usam a mesma reserva.',
    },
  ],
} satisfies ChangelogEntry;
