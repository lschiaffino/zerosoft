import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-chat-polish',
  date: '2026-11-16',
  title: {
    en: 'Inbox and Lines: animated stickers, snooze from a swipe and the contact’s phone',
    es: 'Inbox y Lines: stickers animados, posponer al deslizar y el teléfono del contacto',
    pt: 'Inbox e Lines: figurinhas animadas, adiar ao deslizar e o telefone do contato',
  },
  items: [
    {
      product: 'inbox',
      en: 'An animated sticker you send now arrives animated. Before, it was converted on the way and only its first frame reached the chat.',
      es: 'Un sticker animado que mandás ahora llega animado. Antes se convertía en el camino y al chat llegaba solo su primer cuadro.',
      pt: 'Uma figurinha animada que você envia agora chega animada. Antes ela era convertida no caminho e só o primeiro quadro chegava à conversa.',
    },
    {
      product: 'inbox',
      en: 'The Stickers tab scrolls with the mouse wheel and with your finger, so the whole collection is reachable.',
      es: 'La pestaña Stickers corre con la rueda del mouse y con el dedo, así llegás a toda la colección.',
      pt: 'A aba Figurinhas rola com a roda do mouse e com o dedo, então dá para chegar à coleção inteira.',
    },
    {
      product: 'inbox',
      en: 'Swiping a chat to the right shows Snooze next to Unread and Pin. Swiping all the way to archive removes the row at once, with Undo.',
      es: 'Deslizar un chat a la derecha muestra Posponer junto a No leído y Fijar. Deslizar hasta el fondo para archivar saca la fila enseguida, con Deshacer.',
      pt: 'Deslizar uma conversa para a direita mostra Adiar ao lado de Não lida e Fixar. Deslizar até o fim para arquivar tira a linha na hora, com Desfazer.',
    },
    {
      product: 'inbox',
      en: 'A narrow photo with a caption keeps the full media width, so the caption reads in normal lines.',
      es: 'Una foto angosta con texto mantiene el ancho completo de la media, así el texto se lee en renglones normales.',
      pt: 'Uma foto estreita com legenda mantém a largura total da mídia, então a legenda é lida em linhas normais.',
    },
    {
      product: 'inbox',
      en: 'Contact info shows the phone number under the name, also for chats WhatsApp only identifies by an anonymous id once the number is known. Click it to copy.',
      es: 'La info del contacto muestra el teléfono debajo del nombre, también en los chats que WhatsApp identifica solo con un id anónimo cuando ya se conoce el número. Un clic lo copia.',
      pt: 'Os dados do contato mostram o telefone embaixo do nome, também nas conversas que o WhatsApp identifica só com um id anônimo quando o número já é conhecido. Um clique copia.',
    },
    {
      product: 'groups',
      en: 'The same in Lines: animated stickers, a scrolling Stickers tab, Snooze in the swipe, quick archive, wide photos with captions and the phone in contact info (hidden for members who cannot see numbers).',
      es: 'Lo mismo en Lines: stickers animados, la pestaña Stickers que corre, Posponer al deslizar, archivar rápido, fotos anchas con texto y el teléfono en la info del contacto (oculto para quien no ve los números).',
      pt: 'O mesmo no Lines: figurinhas animadas, a aba Figurinhas que rola, Adiar ao deslizar, arquivar rápido, fotos largas com legenda e o telefone nos dados do contato (oculto para quem não vê os números).',
    },
    {
      product: 'groups',
      en: 'With the sidebar collapsed, folders fit the rail without sideways scrolling. Hover one to see its full name.',
      es: 'Con la barra lateral colapsada, las carpetas entran en el riel sin scroll de costado. Pasá el mouse por una para ver su nombre completo.',
      pt: 'Com a barra lateral recolhida, as pastas cabem no trilho sem rolagem lateral. Passe o mouse sobre uma para ver o nome completo.',
    },
    {
      product: 'platform',
      en: 'The new version notice says what is new, with a link to the changelog.',
      es: 'El aviso de versión nueva dice qué trae, con un enlace a las novedades.',
      pt: 'O aviso de versão nova diz o que ela traz, com um link para as novidades.',
    },
  ],
} satisfies ChangelogEntry;
