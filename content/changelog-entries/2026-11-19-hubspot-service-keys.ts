import type { ChangelogEntry } from '../changelog';

export default {
  id: '2026-11-19-hubspot-service-keys',
  date: '2026-11-19',
  title: {
    en: 'HubSpot: connect with a service key',
    es: 'HubSpot: conectar con una service key',
    pt: 'HubSpot: conectar com uma service key',
  },
  items: [
    {
      product: 'crm',
      en: 'HubSpot no longer lets you create private apps, so the HubSpot import now also takes a service key. The steps on screen cover both cases: creating a service key, or using the private app your account already has. After you connect, the preview shows which HubSpot account the key belongs to and what it can read. If a scope is missing, it says which one in plain words.',
      es: 'HubSpot ya no deja crear private apps, así que el import de HubSpot ahora también acepta una service key. Los pasos en pantalla cubren los dos casos: crear una service key o usar la private app que tu cuenta ya tiene. Al conectar, la vista previa muestra de qué cuenta de HubSpot es la clave y qué puede leer. Si falta un permiso, dice cuál en palabras simples.',
      pt: 'O HubSpot não deixa mais criar private apps, então a importação do HubSpot agora também aceita uma service key. Os passos na tela cobrem os dois casos: criar uma service key ou usar o private app que sua conta já tem. Ao conectar, a prévia mostra de qual conta do HubSpot é a chave e o que ela pode ler. Se faltar uma permissão, diz qual em palavras simples.',
    },
    {
      product: 'groups',
      en: 'Lines > Settings > Integrations > HubSpot takes a service key or the token of an existing private app, with the steps for each. Once connected it shows the account, the kind of key and what it can and cannot do yet. Service keys cannot receive webhooks, so with one Lines checks HubSpot for changes about once a minute.',
      es: 'Lines > Ajustes > Integraciones > HubSpot acepta una service key o el token de una private app que ya existe, con los pasos de cada caso. Una vez conectado muestra la cuenta, el tipo de clave y qué puede hacer y qué todavía no. Las service keys no reciben webhooks: con una, Lines revisa los cambios de HubSpot más o menos una vez por minuto.',
      pt: 'Lines > Ajustes > Integrações > HubSpot aceita uma service key ou o token de um private app que já existe, com os passos de cada caso. Depois de conectar mostra a conta, o tipo de chave e o que ela pode fazer e o que ainda não. As service keys não recebem webhooks: com uma, o Lines confere as mudanças do HubSpot mais ou menos uma vez por minuto.',
    },
  ],
} satisfies ChangelogEntry;
