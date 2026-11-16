import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-rec-remove-reaction',
  date: '2026-11-15',
  title: {
    en: 'Rec: remove a reaction you left on a video',
    es: 'Rec: quitá una reacción que dejaste en un video',
    pt: 'Rec: remova uma reação que você deixou em um vídeo',
  },
  items: [
    {
      product: 'rec',
      en: 'A reaction on a video could not be taken back. Now a click on its emoji on the timeline opens a small box with who reacted, the second, and "Remove reaction". You can remove your own, with or without an account, and whoever manages the video can remove any.',
      es: 'Una reacción en un video no se podía sacar. Ahora un clic en su emoji de la línea de tiempo abre un cuadro con quién reaccionó, el segundo y "Quitar reacción". Podés quitar las tuyas, con o sin cuenta, y quien administra el video puede quitar cualquiera.',
      pt: 'Uma reação em um vídeo não podia ser desfeita. Agora um clique no emoji dela na linha do tempo abre um quadro com quem reagiu, o segundo e "Remover reação". Você remove as suas, com ou sem conta, e quem administra o vídeo remove qualquer uma.',
    },
    {
      product: 'rec',
      en: 'Under the video, the emojis you already used are highlighted and "Your reactions" lists each one with its second and an × to remove it. Clicking an emoji again still adds another reaction at the current second.',
      es: 'Debajo del video, los emojis que ya usaste quedan resaltados y "Tus reacciones" lista cada una con su segundo y una × para quitarla. Otro clic en un emoji sigue sumando una reacción en el segundo actual.',
      pt: 'Abaixo do vídeo, os emojis que você já usou ficam destacados e "Suas reações" lista cada uma com o segundo e um × para remover. Outro clique em um emoji continua somando uma reação no segundo atual.',
    },
  ],
} satisfies ChangelogEntry;
