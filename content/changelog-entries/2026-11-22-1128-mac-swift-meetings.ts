import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1128-mac-swift-meetings',
  date: '2026-11-22',
  title: {
    en: 'New Mac app (in testing): meeting notes with the other side of the call',
    es: 'Nueva app de Mac (en pruebas): notas de reunión con el otro lado de la llamada',
    pt: 'Novo app de Mac (em testes): notas de reunião com o outro lado da chamada',
  },
  items: [
    {
      product: 'platform',
      en: 'The native Mac app we are building for the App Store now records meetings in Voice with the computer\'s audio, so the notes include what the other people on a call say, not only your microphone. It captures only while a meeting you started records, from the tab you are using, and keeps none of it on your Mac. macOS asks for permission the first time a meeting captures it, never when the app opens. While a meeting records, its tab and the menu bar item show a red dot (the item shows even if you hid it), and when the tab is not in front a small indicator stays on top of other apps: click it to go back, hover to see the time, right-click to stop or hide it. Settings has a new Meetings section to turn the indicator or the computer\'s audio off.',
      es: 'La app nativa de Mac que estamos haciendo para la App Store ahora graba las reuniones de Voice con el audio de la computadora, así las notas incluyen lo que dice la otra gente de una llamada y no solo tu micrófono. Captura solo mientras se graba una reunión que empezaste vos, desde la pestaña que estás usando, y no guarda nada de eso en tu Mac. macOS pide permiso la primera vez que una reunión lo captura, nunca al abrir la app. Mientras se graba una reunión, su pestaña y el ícono de la barra de menú muestran un punto rojo (el ícono aparece aunque lo hayas ocultado), y cuando la pestaña no está adelante un indicador chico queda encima de las otras apps: un clic te lleva de vuelta, con el mouse encima muestra el tiempo y con clic derecho lo cortás u ocultás. Ajustes tiene una sección nueva de Reuniones para apagar el indicador o el audio de la computadora.',
      pt: 'O app nativo de Mac que estamos fazendo para a App Store agora grava as reuniões do Voice com o áudio do computador, assim as notas incluem o que as outras pessoas de uma chamada dizem e não só o seu microfone. Ele captura só enquanto grava uma reunião que você começou, a partir da aba que você está usando, e não guarda nada disso no seu Mac. O macOS pede permissão na primeira vez que uma reunião captura, nunca ao abrir o app. Enquanto uma reunião é gravada, a aba dela e o ícone da barra de menus mostram um ponto vermelho (o ícone aparece mesmo se você o ocultou), e quando a aba não está na frente um indicador pequeno fica sobre os outros apps: um clique leva você de volta, com o mouse em cima mostra o tempo e com o clique direito você para ou oculta. Os Ajustes têm uma seção nova de Reuniões para desligar o indicador ou o áudio do computador.',
    },
  ],
} satisfies ChangelogEntry;
