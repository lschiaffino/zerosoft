import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-voice-warm',
  date: '2026-11-15',
  title: {
    en: 'Voice: the first dictation is as fast as the rest',
    es: 'Voice: el primer dictado es tan rápido como los demás',
    pt: 'Voice: o primeiro ditado é tão rápido quanto os outros',
  },
  items: [
    {
      product: 'voice',
      en: 'The first dictation after a while used to take much longer than the next ones, because the server had to start up while you waited. Now it stays ready, and the desktop app also wakes it up as soon as you start talking.',
      es: 'El primer dictado después de un rato tardaba mucho más que los siguientes, porque el servidor tenía que arrancar mientras esperabas. Ahora queda listo, y la app de escritorio además lo despierta apenas empezás a hablar.',
      pt: 'O primeiro ditado depois de um tempo demorava muito mais que os seguintes, porque o servidor precisava iniciar enquanto você esperava. Agora ele fica pronto, e o app para desktop também o acorda assim que você começa a falar.',
    },
  ],
} satisfies ChangelogEntry;
