import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-lines-inbox-looks-pass',
  date: '2026-11-23',
  title: {
    en: 'Lines and Inbox: the chat follows every look, and dictation no longer covers messages',
    es: 'Lines e Inbox: el chat sigue cada aspecto y el dictado ya no tapa mensajes',
    pt: 'Lines e Inbox: a conversa segue cada aspecto e o ditado não cobre mais mensagens',
  },
  items: [
    {
      product: 'inbox',
      en: 'The dictation button of a WhatsApp chat now sits inside the message field, at its right edge, in the same place with either chat style. It used to float above the field and could cover the time of the last message. The small feedback tab no longer shows cut off at the right edge of an open chat. The message menu also has Select, as in Lines, to pick several messages from a computer.',
      es: 'El botón de dictado de un chat de WhatsApp ahora va dentro del campo del mensaje, en su borde derecho, en el mismo lugar con cualquier estilo de chat. Antes flotaba encima del campo y podía tapar la hora del último mensaje. La pestañita de feedback ya no aparece cortada en el borde derecho de un chat abierto. El menú del mensaje suma Seleccionar, como en Lines, para elegir varios mensajes desde la computadora.',
      pt: 'O botão de ditado de uma conversa do WhatsApp agora fica dentro do campo da mensagem, na borda direita, no mesmo lugar com qualquer estilo de conversa. Antes flutuava acima do campo e podia cobrir o horário da última mensagem. A pequena aba de feedback não aparece mais cortada na borda direita de uma conversa aberta. O menu da mensagem ganha Selecionar, como no Lines, para escolher várias mensagens no computador.',
    },
    {
      product: 'groups',
      en: 'Lines and Inbox follow the Lines, Classic, Liquid and Retro looks. With Lines or Classic, the emoji, GIF and sticker panel and the Message info and reactions windows have the same edge, corners and shadow as the chat menus. Liquid turns the emoji panel into glass and keeps chips and tabs from turning into capsules. Retro dresses the list, header, bubbles, fields and buttons as Windows 98, with the open chat as a blue selection. In Classic, segmented buttons (like the chat Display options in Settings) read as one control. On a phone, the emoji categories sit in two even rows.',
      es: 'Lines e Inbox siguen los aspectos Líneas, Clásico, Líquido y Retro. Con Líneas o Clásico, el panel de emojis, GIFs y stickers y las ventanas de Info del mensaje y de reacciones tienen el mismo borde, esquinas y sombra que los menús del chat. Líquido hace de vidrio el panel de emojis y evita que los chips y las pestañas queden como cápsulas. Retro viste la lista, el encabezado, las burbujas, los campos y los botones como Windows 98, con el chat abierto como una selección azul. En Clásico, los botones en segmentos (como las opciones de Visualización del chat en Ajustes) se leen como un solo control. En el teléfono, las categorías de emojis van en dos renglones parejos.',
      pt: 'Lines e Inbox seguem os aspectos Linhas, Clássico, Líquido e Retrô. Com Linhas ou Clássico, o painel de emojis, GIFs e figurinhas e as janelas de Dados da mensagem e de reações têm a mesma borda, cantos e sombra que os menus da conversa. Líquido deixa o painel de emojis de vidro e evita que chips e abas virem cápsulas. Retrô veste a lista, o cabeçalho, os balões, os campos e os botões como o Windows 98, com a conversa aberta como uma seleção azul. No Clássico, os botões em segmentos (como as opções de Exibição da conversa nas Configurações) são lidos como um só controle. No celular, as categorias de emojis ficam em duas linhas iguais.',
    },
  ],
} satisfies ChangelogEntry;
