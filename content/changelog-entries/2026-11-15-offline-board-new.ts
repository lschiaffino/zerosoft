import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-offline-board-new',
  date: '2026-11-15',
  title: {
    en: 'Board: new boards offline, and drawings come back on their own',
    es: 'Board: pizarras nuevas sin conexión, y lo dibujado vuelve solo',
    pt: 'Board: quadros novos sem conexão, e o desenho volta sozinho',
  },
  items: [
    {
      product: 'board',
      en: 'You can create a board without a connection. It shows up in your list as on this device, you can draw on it and reload it, and it uploads once when you are back online, with everything you drew. When you reload a board you drew on offline, your changes come back without asking; if someone saved a newer version in the meantime, you still choose whether to restore them.',
      es: 'Ahora podés crear una pizarra sin conexión. Aparece en tu lista como en este dispositivo, podés dibujar en ella y recargarla, y se sube una sola vez cuando vuelve la red, con todo lo que dibujaste. Al recargar una pizarra en la que dibujaste sin red, tus cambios vuelven sin preguntar; si alguien guardó una versión más nueva mientras tanto, seguís eligiendo si recuperarlos.',
      pt: 'Agora você pode criar um quadro sem conexão. Ele aparece na sua lista como neste dispositivo, você pode desenhar nele e recarregá-lo, e ele é enviado uma única vez quando a conexão volta, com tudo o que você desenhou. Ao recarregar um quadro em que você desenhou sem conexão, suas alterações voltam sem perguntar; se alguém salvou uma versão mais nova enquanto isso, você ainda escolhe se quer recuperá-las.',
    },
  ],
} satisfies ChangelogEntry;
