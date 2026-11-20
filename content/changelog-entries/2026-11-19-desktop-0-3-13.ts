import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-desktop-0-3-13',
  date: '2026-11-19',
  title: {
    en: 'Desktop 0.3.13: Rec records your computer audio on Mac',
    es: 'Escritorio 0.3.13: Rec graba el audio de la compu en Mac',
    pt: 'Desktop 0.3.13: o Rec grava o áudio do computador no Mac',
  },
  items: [
    {
      product: 'rec',
      en: 'Version 0.3.13 of the desktop app is out and arrives as an automatic update. On a Mac, recording with Rec now mixes what plays on the computer with your microphone, using the same native capture as Voice meetings (macOS 13 or later). While Rec records, its floating bar is the only indicator on screen: the separate computer audio indicator no longer shows on top of it. The dot in the menu bar stays.',
      es: 'Salió la versión 0.3.13 de la app de escritorio y llega como actualización automática. En Mac, grabar con Rec ahora mezcla lo que suena en la compu con tu micrófono, con la misma captura nativa que las reuniones de Voice (macOS 13 o más). Mientras Rec graba, su barra flotante es el único indicador en pantalla: ya no aparece encima el indicador aparte del audio de la compu. El punto de la barra de menú sigue.',
      pt: 'Saiu a versão 0.3.13 do app para desktop, que chega como atualização automática. No Mac, gravar com o Rec agora mistura o que toca no computador com o seu microfone, usando a mesma captura nativa das reuniões do Voice (macOS 13 ou mais recente). Enquanto o Rec grava, a barra flutuante dele é o único indicador na tela: o indicador separado do áudio do computador não aparece mais por cima. O ponto na barra de menus continua.',
    },
  ],
} satisfies ChangelogEntry;
