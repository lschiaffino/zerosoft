import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-17-analytics-talk-voice',
  date: '2026-11-17',
  title: {
    en: 'Talk and Voice: analytics with the same layout as Lines',
    es: 'Talk y Voice: analítica con el mismo formato que Lines',
    pt: 'Talk e Voice: análises com o mesmo formato do Lines',
  },
  items: [
    {
      product: 'talk',
      en: 'New Analytics page: messages, thread replies, people posting, reactions, huddles and time in huddles against the previous period, activity per day, when people post, who posts, public and private channels against direct messages, and a table by channel. Filter by channel. It covers the conversations you can read and never reads message text.',
      es: 'Nueva página de Analítica: mensajes, respuestas en hilos, personas que escriben, reacciones, huddles y tiempo en huddles contra el período anterior, actividad por día, cuándo se escribe, quién escribe, canales públicos y privados contra mensajes directos y una tabla por canal. Filtro por canal. Abarca las conversaciones que podés leer y nunca lee el texto de los mensajes.',
      pt: 'Nova página de Análises: mensagens, respostas em threads, pessoas que escrevem, reações, huddles e tempo em huddles contra o período anterior, atividade por dia, quando se escreve, quem escreve, canais públicos e privados contra mensagens diretas e uma tabela por canal. Filtro por canal. Cobre as conversas que você pode ler e nunca lê o texto das mensagens.',
    },
    {
      product: 'voice',
      en: 'New Analytics page with your own numbers: meetings, time in meetings, AI notes, dictations, words dictated and words per minute against the previous period, activity per day, when you record, where you dictate and a table of the meetings in the period. Filter by meetings or dictation.',
      es: 'Nueva página de Analítica con tus propios números: reuniones, tiempo en reuniones, notas con IA, dictados, palabras dictadas y palabras por minuto contra el período anterior, actividad por día, cuándo grabás, dónde dictás y una tabla de las reuniones del período. Filtro por reuniones o dictado.',
      pt: 'Nova página de Análises com os seus próprios números: reuniões, tempo em reuniões, notas com IA, ditados, palavras ditadas e palavras por minuto contra o período anterior, atividade por dia, quando você grava, onde dita e uma tabela das reuniões do período. Filtro por reuniões ou ditado.',
    },
  ],
} satisfies ChangelogEntry;
