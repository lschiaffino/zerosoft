import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-16-rec-desktop-system-audio',
  date: '2026-11-16',
  title: {
    en: 'Rec: the Mac desktop app records your computer audio',
    es: 'Rec: la app de escritorio en Mac graba el audio de la compu',
    pt: 'Rec: o app para desktop no Mac grava o áudio do computador',
  },
  items: [
    {
      product: 'rec',
      en: 'Recording your screen from the desktop app on a Mac now includes what plays on the computer (a call, a video, an app), mixed with your microphone in the same video. Before, only the microphone was recorded, because the Mac webview does not share system audio. The option is called Computer audio and is on by default. If it is on and the audio does not come through, a notice says so while you record and opens the app settings. On Windows the desktop app already shared it when you pick the entire screen.',
      es: 'Grabar la pantalla desde la app de escritorio en Mac ahora suma lo que suena en la compu (una llamada, un video, una app), mezclado con tu micrófono en el mismo video. Antes se grababa solo el micrófono, porque el webview de Mac no comparte el audio del sistema. La opción se llama Audio de la compu y viene prendida. Si está prendida y el audio no llega, un aviso lo dice mientras grabás y abre los ajustes de la app. En Windows la app ya lo compartía al elegir la pantalla entera.',
      pt: 'Gravar a tela pelo app para desktop no Mac agora inclui o que toca no computador (uma chamada, um vídeo, um app), misturado com o seu microfone no mesmo vídeo. Antes só o microfone era gravado, porque o webview do Mac não compartilha o áudio do sistema. A opção se chama Áudio do computador e vem ligada. Se estiver ligada e o áudio não chegar, um aviso diz isso enquanto você grava e abre os ajustes do app. No Windows o app já compartilhava ao escolher a tela inteira.',
    },
  ],
} satisfies ChangelogEntry;
