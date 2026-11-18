import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-18-lines-reply-from',
  date: '2026-11-18',
  title: {
    en: 'Reply from: pick the line a reply goes out on',
    es: 'Responder desde: elegí por qué línea sale la respuesta',
    pt: 'Responder de: escolha por qual linha sai a resposta',
  },
  items: [
    {
      product: 'groups',
      en: 'When a chat is on more than one of your lines, the composer shows Reply from. It starts on the line of the last message that came in or went out, and you can pick another one. Texts, files, voice notes, stickers, polls and contacts go out on the line you picked, and the chat shows it on the message.',
      es: 'Cuando un chat está en más de una de tus líneas, el campo de escribir muestra Responder desde. Empieza en la línea del último mensaje que entró o salió, y podés elegir otra. Textos, archivos, notas de voz, stickers, encuestas y contactos salen por la línea elegida, y el chat la muestra en el mensaje.',
      pt: 'Quando uma conversa está em mais de uma das suas linhas, o campo de escrever mostra Responder de. Começa na linha da última mensagem que chegou ou saiu, e você pode escolher outra. Textos, arquivos, notas de voz, figurinhas, enquetes e contatos saem pela linha escolhida, e a conversa mostra isso na mensagem.',
    },
  ],
} satisfies ChangelogEntry;
