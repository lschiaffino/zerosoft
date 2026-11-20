import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-crm-hubspot-sync-preview',
  date: '2026-11-19',
  title: {
    en: 'CRM: connect HubSpot and preview what a sync would do',
    es: 'CRM: conectá HubSpot y mirá qué haría un sync',
    pt: 'CRM: conecte o HubSpot e veja o que uma sincronização faria',
  },
  items: [
    {
      product: 'crm',
      en: 'First step of the two-way sync with HubSpot. In CRM settings › Integrations an admin connects the HubSpot account with a service key or the token of a legacy private app. We check the key and show the account, the kind of key and what it can do in plain words. If the workspace already connected HubSpot in Lines, the same key can be used without pasting it again. The key is stored encrypted and is never shown again.',
      es: 'Primer paso del sync de ida y vuelta con HubSpot. En Ajustes del CRM › Integraciones un admin conecta la cuenta de HubSpot con una service key o el token de una private app heredada. Revisamos la clave y mostramos la cuenta, el tipo de clave y qué puede hacer, en palabras. Si el workspace ya conectó HubSpot en Lines, se puede usar esa misma clave sin volver a pegarla. La clave se guarda cifrada y no se vuelve a mostrar.',
      pt: 'Primeiro passo da sincronização nos dois sentidos com o HubSpot. Em Ajustes do CRM › Integrações um admin conecta a conta do HubSpot com uma service key ou o token de uma private app legada. Conferimos a chave e mostramos a conta, o tipo de chave e o que ela pode fazer, em palavras. Se o workspace já conectou o HubSpot no Lines, dá para usar essa mesma chave sem colar de novo. A chave fica criptografada e não é mostrada de novo.',
    },
    {
      product: 'crm',
      en: 'Preview what a sync would do: it reads both sides and shows, for contacts, companies and deals, how many are on each side, which ones match (contacts by email, companies by domain, deals only if they were imported from that account), what would be created on each side, what would be updated and what a person has to decide, such as two HubSpot companies with the same domain or contacts without an email. It also lists owners, pipelines, stages and properties with no equivalent. Each group opens to show a sample of records.',
      es: 'Vista previa de lo que haría un sync: lee los dos lados y muestra, para contactos, empresas y deals, cuántos hay de cada lado, cuáles coinciden (contactos por email, empresas por dominio, deals solo si se importaron de esa cuenta), qué se crearía de cada lado, qué se actualizaría y qué tiene que decidir una persona, como dos empresas de HubSpot con el mismo dominio o contactos sin email. También lista owners, pipelines, etapas y propiedades sin equivalente. Cada grupo se abre para ver una muestra de registros.',
      pt: 'Prévia do que uma sincronização faria: lê os dois lados e mostra, para contatos, empresas e negócios, quantos há de cada lado, quais coincidem (contatos por email, empresas por domínio, negócios só se foram importados dessa conta), o que seria criado de cada lado, o que seria atualizado e o que uma pessoa precisa decidir, como duas empresas do HubSpot com o mesmo domínio ou contatos sem email. Também lista owners, pipelines, etapas e propriedades sem equivalente. Cada grupo abre para mostrar uma amostra de registros.',
    },
    {
      product: 'crm',
      en: 'The preview only reads: nothing is written to HubSpot or to the CRM, and the sync itself cannot be turned on yet. It runs in the background, shows its progress, can be cancelled and is only for workspace admins. It does not compare custom field values, timeline activity or associations yet.',
      es: 'La vista previa solo lee: no se escribe nada en HubSpot ni en el CRM, y el sync en sí todavía no se puede prender. Corre en segundo plano, muestra su avance, se puede cancelar y es solo para admins del workspace. Todavía no compara los valores de los campos personalizados, la actividad del timeline ni las asociaciones.',
      pt: 'A prévia só lê: nada é escrito no HubSpot nem no CRM, e a sincronização em si ainda não pode ser ligada. Ela roda em segundo plano, mostra o andamento, pode ser cancelada e é só para admins do workspace. Ainda não compara os valores dos campos personalizados, a atividade da timeline nem as associações.',
    },
  ],
} satisfies ChangelogEntry;
