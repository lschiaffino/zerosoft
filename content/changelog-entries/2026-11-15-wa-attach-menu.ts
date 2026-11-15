import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-wa-attach-menu',
  date: '2026-11-15',
  title: {
    en: 'Inbox and Lines: the + menu works like WhatsApp',
    es: 'Inbox y Lines: el menú + funciona como en WhatsApp',
    pt: 'Inbox e Lines: o menu + funciona como no WhatsApp',
  },
  items: [
    {
      product: 'inbox',
      en: 'The + button next to the message field now has the WhatsApp options, in the same order and with colored icons: document, photos and videos, camera, audio, contact, poll and new sticker. Camera opens your computer camera to take a photo, contact sends contact cards, poll sends a WhatsApp poll, and new sticker turns an image into a sticker and sends it. Help me write, dictate and commands are below a line.',
      es: 'El botón + al lado del campo ahora tiene las opciones de WhatsApp, en el mismo orden y con íconos de color: documento, fotos y videos, cámara, audio, contacto, encuesta y sticker nuevo. Cámara abre la cámara de la computadora para sacar una foto, contacto manda tarjetas de contacto, encuesta manda una encuesta de WhatsApp y sticker nuevo convierte una imagen en sticker y lo manda. Ayudame a escribir, dictar y comandos quedan debajo de una línea.',
      pt: 'O botão + ao lado do campo agora tem as opções do WhatsApp, na mesma ordem e com ícones coloridos: documento, fotos e vídeos, câmera, áudio, contato, enquete e nova figurinha. Câmera abre a câmera do computador para tirar uma foto, contato envia cartões de contato, enquete envia uma enquete do WhatsApp e nova figurinha transforma uma imagem em figurinha e envia. Me ajude a escrever, ditar e comandos ficam abaixo de uma linha.',
    },
    {
      product: 'groups',
      en: 'Lines has the same menu. Camera now also works on a computer, new sticker and dictate are new, and poll and contact only show when the line can send them.',
      es: 'Lines tiene el mismo menú. Cámara ahora también funciona en la computadora, sticker nuevo y dictar son nuevos, y encuesta y contacto aparecen solo si la línea los puede mandar.',
      pt: 'O Lines tem o mesmo menu. Câmera agora também funciona no computador, nova figurinha e ditar são novos, e enquete e contato só aparecem se a linha pode enviá-los.',
    },
  ],
} satisfies ChangelogEntry;
