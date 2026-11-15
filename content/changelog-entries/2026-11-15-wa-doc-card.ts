import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-doc-card',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: documents look like WhatsApp and keep their edited caption',
    es: 'Inbox y Lines: los documentos se ven como en WhatsApp y conservan el texto editado',
    pt: 'Inbox e Lines: documentos aparecem como no WhatsApp e mantêm a legenda editada',
  },
  items: [
    {
      product: 'inbox',
      en: 'When someone edited the caption of a file, photo or video, the caption disappeared and only "Edited" was left. The new caption now replaces the old one. The document card follows WhatsApp: the file icon with its type label in color, the name on one line (shortened in the middle so the extension shows) and "45 kB • html" below; the whole card opens the file, without the round button. In groups, the message menu no longer covers the sender’s number.',
      es: 'Cuando alguien editaba el texto de un archivo, una foto o un video, el texto desaparecía y quedaba solo "Editado". Ahora el texto nuevo reemplaza al anterior. La tarjeta de los documentos sigue a WhatsApp: el ícono del archivo con su tipo en color, el nombre en un renglón (cortado en el medio para que se vea la extensión) y "45 kB • html" abajo; toda la tarjeta abre el archivo, sin el botón redondo. En los grupos, el menú del mensaje ya no tapa el número de quien escribe.',
      pt: 'Quando alguém editava a legenda de um arquivo, foto ou vídeo, a legenda sumia e ficava só "Editado". Agora a legenda nova substitui a anterior. O cartão de documentos segue o WhatsApp: o ícone do arquivo com o tipo em cor, o nome em uma linha (cortado no meio para mostrar a extensão) e "45 kB • html" embaixo; o cartão inteiro abre o arquivo, sem o botão redondo. Nos grupos, o menu da mensagem não cobre mais o número de quem escreve.',
    },
    {
      product: 'groups',
      en: 'The same in Lines.',
      es: 'Lo mismo en Lines.',
      pt: 'O mesmo no Lines.',
    },
  ],
} satisfies ChangelogEntry;
