import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-20-software-directory',
  date: '2026-11-20',
  title: {
    en: 'A public software directory: open source and paid, by category',
    es: 'Un directorio público de software: open source y pago, por categoría',
    pt: 'Um diretório público de software: open source e pago, por categoria',
  },
  items: [
    {
      product: 'platform',
      en: 'zerosoft.ai/software lists open-source and paid software for 20 kinds of work, from CRM and team chat to e-signatures and BI. Each category has its own page with every open-source project, its license and a link to its code, the source-available ones apart, the paid ones, and the zerosoft app that does the same job. Licenses were checked in each repository; prices are left out because they change often.',
      es: 'zerosoft.ai/software lista software open source y pago para 20 tipos de trabajo, desde CRM y chat de equipo hasta firma electrónica y BI. Cada categoría tiene su página con cada proyecto open source, su licencia y el link a su código, los source-available aparte, los pagos, y la app de zerosoft que hace lo mismo. Las licencias se revisaron en cada repositorio; los precios no están porque cambian seguido.',
      pt: 'zerosoft.ai/software lista software open source e pago para 20 tipos de trabalho, de CRM e chat de equipe até assinatura eletrônica e BI. Cada categoria tem sua página com cada projeto open source, sua licença e o link para o código, os source-available à parte, os pagos, e o app do zerosoft que faz o mesmo. As licenças foram conferidas em cada repositório; os preços ficaram de fora porque mudam com frequência.',
    },
  ],
} satisfies ChangelogEntry;
