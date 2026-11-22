import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-22-1500-mac-swift-rec',
  date: '2026-11-22',
  title: {
    en: 'New Mac app (in testing): Rec with a floating bar and your camera in a bubble',
    es: 'Nueva app de Mac (en pruebas): Rec con una barra flotante y tu cámara en una burbuja',
    pt: 'Novo app de Mac (em testes): Rec com uma barra flutuante e a sua câmera em uma bolha',
  },
  items: [
    {
      product: 'platform',
      en: 'The native Mac app we are building for the App Store now has Rec\'s floating controls. While you record, a bar stays on top of other apps with the time, your microphone, pause, restart, discard and Finish, and it never shows up in the video. When you record the whole screen with your camera, your face goes in a round bubble you can drag anywhere and resize; the video records it where you leave it. ⌥⇧P pauses or resumes and ⌥⇧S finishes from any app (⌃⌥P and ⌃⌥S on Macs that do not allow the first ones). Only the tab you are using can start the bar, and macOS asks for the camera the first time you use it, never when the app opens. While Rec records, the menu bar item shows a red dot with Open and Finish, and Settings › Permissions now lists the camera and screen recording.',
      es: 'La app nativa de Mac que estamos haciendo para la App Store ahora tiene los controles flotantes de Rec. Mientras grabás, una barra queda encima de las otras apps con el tiempo, tu micrófono, pausa, empezar de nuevo, descartar y Terminar, y nunca sale en el video. Cuando grabás la pantalla entera con tu cámara, tu cara va en una burbuja redonda que podés arrastrar a donde quieras y agrandar; el video la graba donde la dejes. ⌥⇧P pausa o sigue y ⌥⇧S termina desde cualquier app (⌃⌥P y ⌃⌥S en las Mac que no dejan usar los primeros). Solo la pestaña que estás usando puede mostrar la barra, y macOS pide la cámara la primera vez que la usás, nunca al abrir la app. Mientras Rec graba, el ícono de la barra de menú muestra un punto rojo con Abrir y Terminar, y Ajustes › Permisos ahora muestra la cámara y la grabación de pantalla.',
      pt: 'O app nativo de Mac que estamos fazendo para a App Store agora tem os controles flutuantes do Rec. Enquanto você grava, uma barra fica sobre os outros apps com o tempo, o seu microfone, pausar, recomeçar, descartar e Terminar, e ela nunca aparece no vídeo. Quando você grava a tela inteira com a sua câmera, o seu rosto vai em uma bolha redonda que você pode arrastar para qualquer lugar e aumentar; o vídeo grava a bolha onde você deixar. ⌥⇧P pausa ou continua e ⌥⇧S termina de qualquer app (⌃⌥P e ⌃⌥S nos Macs que não permitem os primeiros). Só a aba que você está usando pode mostrar a barra, e o macOS pede a câmera na primeira vez que você a usa, nunca ao abrir o app. Enquanto o Rec grava, o ícone da barra de menus mostra um ponto vermelho com Abrir e Terminar, e os Ajustes › Permissões agora mostram a câmera e a gravação de tela.',
    },
  ],
} satisfies ChangelogEntry;
