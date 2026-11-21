import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-21-rec-embed-start-autoplay',
  date: '2026-11-21',
  title: {
    en: 'Rec: embeds can start at a given second and play on load',
    es: 'Rec: el video insertado puede empezar en un segundo y reproducirse al cargar',
    pt: 'Rec: o vídeo incorporado pode começar num segundo e tocar ao carregar',
  },
  items: [
    {
      product: 'rec',
      en: 'In Share › Embed and reset link, fill in Start at (1:30 or 90) and tick Play on load, muted: the embed code updates with ?t= and ?autoplay=1, like Loom. Browsers only let a video play by itself without sound, so it starts muted and the volume button turns it on. A link with ?t= pasted into a tool that reads oEmbed is embedded at that second too.',
      es: 'En Compartir › Insertar y cambiar el link, completá Empezar en (1:30 o 90) y marcá Reproducir al cargar, sin sonido: el código para insertar se actualiza con ?t= y ?autoplay=1, como en Loom. Los navegadores solo dejan que un video arranque solo sin sonido, así que empieza silenciado y el botón de volumen lo activa. Un link con ?t= pegado en una herramienta que lee oEmbed también se inserta en ese segundo.',
      pt: 'Em Compartilhar › Incorporar e trocar o link, preencha Começar em (1:30 ou 90) e marque Tocar ao carregar, sem som: o código para incorporar é atualizado com ?t= e ?autoplay=1, como no Loom. Os navegadores só deixam um vídeo começar sozinho sem som, então ele começa mudo e o botão de volume liga o som. Um link com ?t= colado numa ferramenta que lê oEmbed também é incorporado nesse segundo.',
    },
  ],
} satisfies ChangelogEntry;
