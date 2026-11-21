import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-0634-wa-caption-mentions',
  date: '2026-11-21',
  title: {
    en: 'Mention people in the caption of a photo, video or document in WhatsApp groups',
    es: 'Mencionar personas en el pie de una foto, un video o un documento en grupos de WhatsApp',
    pt: 'Mencionar pessoas na legenda de uma foto, um vídeo ou um documento em grupos do WhatsApp',
  },
  items: [
    {
      product: 'groups',
      en: 'In a group, the caption field of the file preview now has the same @ as the message field: type @ to pick a member (photo, name and number), the mention shows in green and the file goes out with a real WhatsApp mention, so the person gets notified. In the chat the caption shows "@Name", like a text message. Esc or a click outside closes the list without closing the preview.',
      es: 'En un grupo, el pie de la vista previa de archivos ahora tiene la misma @ que el campo del mensaje: con @ se elige a alguien del grupo (foto, nombre y número), la mención se ve en verde y el archivo sale con una mención real de WhatsApp, así a la persona le llega el aviso. En el chat el pie muestra "@Nombre", igual que un mensaje de texto. Esc o un clic afuera cierran la lista sin cerrar la vista previa.',
      pt: 'Em um grupo, a legenda da prévia de arquivos agora tem o mesmo @ do campo da mensagem: com @ se escolhe alguém do grupo (foto, nome e número), a menção aparece em verde e o arquivo sai com uma menção real do WhatsApp, e a pessoa recebe o aviso. Na conversa a legenda mostra "@Nome", como uma mensagem de texto. Esc ou um clique fora fecham a lista sem fechar a prévia.',
    },
    {
      product: 'inbox',
      en: 'The same in Inbox: @mentions in the caption of photos, videos and documents sent to a WhatsApp group.',
      es: 'Lo mismo en Inbox: @menciones en el pie de fotos, videos y documentos que se mandan a un grupo de WhatsApp.',
      pt: 'O mesmo no Inbox: @menções na legenda de fotos, vídeos e documentos enviados a um grupo do WhatsApp.',
    },
  ],
} satisfies ChangelogEntry;
