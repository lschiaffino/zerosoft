import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-voice-speed',
  date: '2026-11-15',
  title: {
    en: 'Voice: dictation waits less before it pastes',
    es: 'Voice: el dictado espera menos antes de pegar',
    pt: 'Voice: o ditado espera menos antes de colar',
  },
  items: [
    {
      product: 'voice',
      en: 'A dictation now asks for your settings, dictionary and quotas while the audio is still arriving, and keeps them for a few seconds for the next dictation. Usage and history are saved after the text is back. The time spent between the audio arriving and the text coming back, outside transcription and cleanup, went from four to seven database round trips in a row down to one. Dictations are transcribed with GPT-4o mini Transcribe, which OpenAI reports as more accurate than Whisper, and fall back to Whisper if it fails. With a Groq key set, Groq goes first because it is the fastest. The response header now also shows how long the session check and the upload took.',
      es: 'Un dictado ahora pide tus ajustes, tu diccionario y las cuotas mientras el audio todavía está llegando, y los guarda unos segundos para el próximo dictado. El consumo y el historial se guardan después de devolver el texto. Fuera de la transcripción y la limpieza, la espera entre que llega el audio y vuelve el texto pasó de cuatro a siete consultas seguidas a la base a una sola. Los dictados se transcriben con GPT-4o mini Transcribe, que según OpenAI es más preciso que Whisper, y si falla siguen con Whisper. Con una clave de Groq configurada, Groq va primero porque es el más rápido. La cabecera de la respuesta ahora también dice cuánto tardaron la sesión y la subida.',
      pt: 'Um ditado agora pede suas configurações, seu dicionário e as cotas enquanto o áudio ainda está chegando, e os guarda por alguns segundos para o próximo ditado. O consumo e o histórico são salvos depois de devolver o texto. Fora da transcrição e da limpeza, a espera entre a chegada do áudio e a volta do texto passou de quatro a sete consultas seguidas ao banco para uma só. Os ditados são transcritos com o GPT-4o mini Transcribe, que segundo a OpenAI é mais preciso que o Whisper, e se ele falhar seguem com o Whisper. Com uma chave da Groq configurada, a Groq vai primeiro por ser a mais rápida. O cabeçalho da resposta agora também mostra quanto demoraram a sessão e o envio.',
    },
  ],
} satisfies ChangelogEntry;
