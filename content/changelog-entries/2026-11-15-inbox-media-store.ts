import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-inbox-media-store',
  date: '2026-11-15',
  title: {
    en: 'Inbox: your WhatsApp photos, audios and documents are kept',
    es: 'Inbox: las fotos, los audios y los documentos de WhatsApp quedan guardados',
    pt: 'Inbox: as fotos, os áudios e os documentos do WhatsApp ficam guardados',
  },
  items: [
    {
      product: 'inbox',
      en: 'Inbox used to ask the WhatsApp server for a file every time you looked at it, so a file could stop showing when the line was linked again. Now each file is downloaded once, as it arrives, and kept in private, encrypted storage that only you can read. It keeps showing while the line is disconnected, and audio and video start faster. A download that fails is retried on its own, with longer waits each time.',
      es: 'Inbox le pedía el archivo al servidor de WhatsApp cada vez que lo mirabas, y por eso un archivo podía dejar de verse cuando la línea se volvía a vincular. Ahora cada archivo se baja una vez, apenas llega, y queda guardado en un lugar privado y cifrado que solo vos podés leer. Se sigue viendo con la línea desconectada, y el audio y el video arrancan más rápido. Una descarga que falla se reintenta sola, con esperas cada vez más largas.',
      pt: 'O Inbox pedia o arquivo ao servidor do WhatsApp cada vez que você olhava, e por isso um arquivo podia deixar de aparecer quando a linha era vinculada de novo. Agora cada arquivo é baixado uma vez, assim que chega, e fica guardado num lugar privado e criptografado que só você pode ler. Continua aparecendo com a linha desconectada, e áudio e vídeo começam mais rápido. Um download que falha é tentado de novo sozinho, com esperas cada vez maiores.',
    },
    {
      product: 'groups',
      en: 'Lines: a file that could not be downloaded when it arrived is retried on its own instead of waiting for someone to open the message.',
      es: 'Lines: un archivo que no se pudo bajar al llegar se reintenta solo, sin esperar a que alguien abra el mensaje.',
      pt: 'Lines: um arquivo que não pôde ser baixado ao chegar é tentado de novo sozinho, sem esperar que alguém abra a mensagem.',
    },
  ],
} satisfies ChangelogEntry;
