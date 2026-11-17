import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-15-rec-analytics-location',
  date: '2026-11-15',
  title: {
    en: 'Rec: who watched, from where and which parts',
    es: 'Rec: quién vio, desde dónde y qué partes',
    pt: 'Rec: quem assistiu, de onde e quais partes',
  },
  items: [
    {
      product: 'rec',
      en: 'The Analytics tab of a video shows each viewer with their approximate city and country, device, browser and the site they came from. Signed-in viewers show their name and the rest are numbered as Viewer 1, 2, 3.',
      es: 'La pestaña Analítica de un video muestra cada espectador con su ciudad y país aproximados, dispositivo, navegador y el sitio de donde vino. Quien entró con sesión aparece con su nombre y el resto numerado como Espectador 1, 2, 3.',
      pt: 'A aba Análises de um vídeo mostra cada espectador com cidade e país aproximados, dispositivo, navegador e o site de onde veio. Quem entrou com sessão aparece com o nome e o resto numerado como Espectador 1, 2, 3.',
    },
    {
      product: 'rec',
      en: 'The retention curve shows where viewers drop off and which parts they watched again, with the exact moment when you hover. There are also views per day and breakdowns by country, city, device and source, and the CSV export includes the new columns.',
      es: 'La curva de retención muestra dónde dejan de mirar y qué partes volvieron a ver, con el momento exacto al pasar el mouse. También hay vistas por día y desgloses por país, ciudad, dispositivo y origen, y el CSV trae las columnas nuevas.',
      pt: 'A curva de retenção mostra onde as pessoas param de assistir e quais partes viram de novo, com o momento exato ao passar o mouse. Também há visualizações por dia e detalhamento por país, cidade, dispositivo e origem, e o CSV traz as colunas novas.',
    },
    {
      product: 'rec',
      en: 'Location comes from our hosting provider and is approximate. We do not store the IP address or the full user agent of viewers, and views recorded before this change were reduced to device, browser and operating system. Only the owner of the video and their team see it.',
      es: 'La ubicación la da nuestro proveedor de hosting y es aproximada. No guardamos la dirección IP ni el user agent completo de quien mira, y las vistas anteriores a este cambio quedaron reducidas a dispositivo, navegador y sistema. Solo la ven el dueño del video y su equipo.',
      pt: 'A localização vem do nosso provedor de hospedagem e é aproximada. Não guardamos o endereço IP nem o user agent completo de quem assiste, e as visualizações anteriores a esta mudança foram reduzidas a dispositivo, navegador e sistema. Só o dono do vídeo e a equipe dele veem.',
    },
  ],
} satisfies ChangelogEntry;
