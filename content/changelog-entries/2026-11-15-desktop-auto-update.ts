import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-desktop-auto-update',
  date: '2026-11-15',
  title: {
    en: 'Desktop app 0.3.10: Check for updates answers, and updates install on their own',
    es: 'App de escritorio 0.3.10: Buscar actualizaciones contesta, y las actualizaciones se instalan solas',
    pt: 'App de desktop 0.3.10: Procurar atualizações responde, e as atualizações se instalam sozinhas',
  },
  items: [
    {
      product: 'platform',
      en: 'Check for updates in the zerosoft menu now always answers in a window: you are up to date (with your version), the new version is downloading, it is ready with a Restart to update button, or what went wrong in plain words. Before, the answer went only to a system notification, which macOS hides while the app is in front, so it looked like nothing happened.',
      es: 'Buscar actualizaciones, en el menú zerosoft, ahora siempre contesta en una ventana: que estás al día (con tu versión), que se está bajando la versión nueva, que está lista con un botón Reiniciar para actualizar, o qué falló en palabras simples. Antes la respuesta iba solo a una notificación del sistema, que macOS esconde con la app adelante, y parecía que no pasaba nada.',
      pt: 'Procurar atualizações, no menu zerosoft, agora sempre responde em uma janela: que você está atualizado (com a sua versão), que a nova versão está sendo baixada, que ela está pronta com um botão Reiniciar para atualizar, ou o que deu errado em palavras simples. Antes a resposta ia só para uma notificação do sistema, que o macOS esconde com o app na frente, e parecia que nada acontecia.',
    },
    {
      product: 'platform',
      en: 'The app checks for updates when it opens and every 4 hours, downloads them in the background and tells you when one is ready. On Mac the new version installs the next time zerosoft opens. Restart to update also shows in the zerosoft menu, and it never restarts in the middle of a recording or a dictation.',
      es: 'La app busca actualizaciones al abrir y cada 4 horas, las baja en segundo plano y avisa cuando hay una lista. En Mac la versión nueva se instala la próxima vez que abrís zerosoft. Reiniciar para actualizar también aparece en el menú zerosoft, y nunca reinicia en medio de una grabación o un dictado.',
      pt: 'O app procura atualizações ao abrir e a cada 4 horas, baixa em segundo plano e avisa quando uma está pronta. No Mac a nova versão é instalada na próxima vez que você abre o zerosoft. Reiniciar para atualizar também aparece no menu zerosoft, e ele nunca reinicia no meio de uma gravação ou de um ditado.',
    },
  ],
} satisfies ChangelogEntry;
