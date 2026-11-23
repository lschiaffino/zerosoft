import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-23-0700-crm-expand-rows',
  date: '2026-11-23',
  title: {
    en: 'CRM: expand a row to see its associations and last activity',
    es: 'CRM: desplegá una fila para ver sus asociaciones y la última actividad',
    pt: 'CRM: expanda uma linha para ver suas associações e a última atividade',
  },
  items: [
    {
      product: 'crm',
      en: 'In contacts, companies and deals, the arrow next to the name opens the row in place. A company shows its contacts and open deals, a contact its deals, and a deal its contacts and companies, each with how many there are and a link to see them all, plus the last activity on the record. You only see the records and activity you have access to. Esc closes the row and puts the focus back on its arrow.',
      es: 'En contactos, empresas y deals, la flecha al lado del nombre despliega la fila ahí mismo. Una empresa muestra sus contactos y sus deals abiertos, un contacto sus deals y un deal sus contactos y empresas, cada uno con cuántos hay y un link para verlos todos, más la última actividad del registro. Solo ves los registros y la actividad a los que tenés acceso. Esc cierra la fila y deja el foco en su flecha.',
      pt: 'Em contatos, empresas e negócios, a seta ao lado do nome abre a linha ali mesmo. Uma empresa mostra seus contatos e negócios abertos, um contato seus negócios e um negócio seus contatos e empresas, cada um com quantos são e um link para ver todos, mais a última atividade do registro. Você só vê os registros e a atividade aos quais tem acesso. Esc fecha a linha e devolve o foco para a seta.',
    },
  ],
} satisfies ChangelogEntry;
