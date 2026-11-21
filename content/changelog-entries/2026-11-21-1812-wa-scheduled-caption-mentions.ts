import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-1812-wa-scheduled-caption-mentions',
  date: '2026-11-21',
  title: {
    en: 'Schedule a photo or file from its preview, with the @mentions of its caption',
    es: 'Programar una foto o un archivo desde su vista previa, con las @menciones del pie',
    pt: 'Agendar uma foto ou um arquivo pela prévia, com as @menções da legenda',
  },
  items: [
    {
      product: 'groups',
      en: 'The file preview now has the clock next to Send (also right-click on Send or ⌘⇧Enter in the caption) to send the file later. In a group, the people mentioned in the caption get a real WhatsApp mention when it goes out, and so do scheduled and recurring messages with a file whose text mentions someone.',
      es: 'La vista previa de archivos ahora tiene el reloj junto a Enviar (también clic derecho en Enviar o ⌘⇧Enter en el pie) para mandar el archivo más tarde. En un grupo, a quienes se menciona en el pie les llega una mención real de WhatsApp cuando sale, y lo mismo en los programados y recurrentes con archivo cuyo texto menciona a alguien.',
      pt: 'A prévia de arquivos agora tem o relógio ao lado de Enviar (também clique direito em Enviar ou ⌘⇧Enter na legenda) para enviar o arquivo mais tarde. Em um grupo, quem é mencionado na legenda recebe uma menção real do WhatsApp quando ele sai, e o mesmo vale para mensagens agendadas e recorrentes com arquivo cujo texto menciona alguém.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox: the clock in the file preview opens Send later with the file already attached and the caption as its text, and the mentions of a scheduled caption go out as WhatsApp mentions.',
      es: 'Lo mismo en Inbox: el reloj de la vista previa abre Enviar más tarde con el archivo ya adjunto y el pie como texto, y las menciones de un pie programado salen como menciones de WhatsApp.',
      pt: 'O mesmo no Inbox: o relógio da prévia abre Enviar mais tarde com o arquivo já anexado e a legenda como texto, e as menções de uma legenda agendada saem como menções do WhatsApp.',
    },
  ],
} satisfies ChangelogEntry;
