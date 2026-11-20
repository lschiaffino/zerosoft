import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-1927-hiring-report-csv',
  date: '2026-11-20',
  title: {
    en: 'Hiring: download each report as CSV',
    es: 'Hiring: cada informe se descarga en CSV',
    pt: 'Hiring: cada relatório pode ser baixado em CSV',
  },
  items: [
    {
      product: 'hiring',
      en: 'In Hiring reports, the funnel, sources, rejection reasons and open jobs each have a Download CSV button. The file has what you see on screen: the period and job you chose, and only the candidates you can see.',
      es: 'En los informes de Hiring, el embudo, las fuentes, los motivos de rechazo y los puestos abiertos tienen cada uno un botón Descargar CSV. El archivo trae lo que ves en pantalla: el período y el puesto elegidos, y solo los candidatos que ves.',
      pt: 'Nos relatórios do Hiring, o funil, as origens, os motivos de recusa e as vagas abertas têm cada um um botão Baixar CSV. O arquivo traz o que você vê na tela: o período e a vaga escolhidos, e só os candidatos que você vê.',
    },
  ],
} satisfies ChangelogEntry;
