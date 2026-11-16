import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-assistant-chats',
  date: '2026-11-15',
  title: {
    en: 'Assistant: what you are behind on in Inbox and Lines, reading chats only with your permission',
    es: 'Asistente: qué tenés atrasado en Inbox y Lines, y lee chats solo con tu permiso',
    pt: 'Assistente: o que está atrasado no Inbox e no Lines, e lê conversas só com sua permissão',
  },
  items: [
    {
      product: 'inbox',
      en: 'Ask the assistant "what am I behind on?" and it lists the chats waiting for your reply and for how long, overdue reminders, chats back from snooze and important unread. For that it only looks at names and times, not at what the messages say.',
      es: 'Preguntale al asistente "¿qué tengo atrasado?" y te lista los chats que esperan tu respuesta y hace cuánto, los recordatorios vencidos, los que volvieron de posponer y los no leídos importantes. Para eso mira solo nombres y horarios, no lo que dicen los mensajes.',
      pt: 'Pergunte ao assistente "o que tenho atrasado?" e ele lista as conversas esperando sua resposta e há quanto tempo, lembretes vencidos, as que voltaram do adiamento e as não lidas importantes. Para isso ele só olha nomes e horários, não o que as mensagens dizem.',
    },
    {
      product: 'inbox',
      en: 'To read your chats (to find what you promised, questions you did not answer, or to summarize a chat) it asks first: allow this time, always, or not. "Always" can be turned off in Settings › Account › Assistant access. What it reads is not saved in the conversation.',
      es: 'Para leer tus chats (encontrar lo que prometiste, preguntas sin responder o resumir un chat) primero te pregunta: permitir esta vez, siempre o no. "Siempre" se apaga en Ajustes › Cuenta › Acceso del asistente. Lo que lee no queda guardado en la charla.',
      pt: 'Para ler suas conversas (achar o que você prometeu, perguntas sem resposta ou resumir uma conversa) ele pergunta antes: permitir desta vez, sempre ou não. "Sempre" se desliga em Configurações › Conta › Acesso do assistente. O que ele lê não fica salvo na conversa.',
    },
    {
      product: 'inbox',
      en: 'Then it suggests what to do in one card: reply drafts (left in the chat, never sent), snooze, a reminder, archive, done or a folder. Nothing changes until you click Confirm.',
      es: 'Después te propone qué hacer en una sola tarjeta: borradores de respuesta (quedan en el chat, nunca se envían), posponer, un recordatorio, archivar, hecho o una carpeta. Nada cambia hasta que tocás Confirmar.',
      pt: 'Depois sugere o que fazer num só cartão: rascunhos de resposta (ficam na conversa, nunca são enviados), adiar, um lembrete, arquivar, feito ou uma pasta. Nada muda até você clicar em Confirmar.',
    },
    {
      product: 'groups',
      en: 'Lines works the same for the shared lines, only with the chats you can see on each line, and with hidden phone numbers when your workspace hides them.',
      es: 'Lines funciona igual con las líneas compartidas, solo con los chats que ves en cada línea, y con los teléfonos ocultos si tu workspace los oculta.',
      pt: 'O Lines funciona igual com as linhas compartilhadas, só com as conversas que você vê em cada linha, e com os telefones ocultos se o seu workspace os oculta.',
    },
    {
      product: 'platform',
      en: 'The assistant answers in the language you write in, even when the app is in another one.',
      es: 'El asistente contesta en el idioma en que le escribís, aunque la app esté en otro.',
      pt: 'O assistente responde no idioma em que você escreve, mesmo com o app em outro.',
    },
  ],
} satisfies ChangelogEntry;
