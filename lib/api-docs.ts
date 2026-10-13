/**
 * Datos estáticos de la documentación de API v1.
 * Los snippets se generan a partir de method + path + body.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ApiParam {
  name: string;
  type: string;
  required?: boolean;
  descriptionKey: string;
}

export interface ApiEndpoint {
  id: string;
  sectionId: string;
  method: HttpMethod;
  path: string;
  titleKey: string;
  descKey: string;
  params?: ApiParam[];
  request?: unknown;
  response?: unknown;
  responseStatus?: number;
}

export interface ApiSection {
  id: string;
  titleKey: string;
  descKey?: string;
}

export const API_BASE_URL = 'https://zerosoft.ai/api/v1';
export const API_ROOT_URL = 'https://zerosoft.ai';

export const API_SECTIONS: ApiSection[] = [
  { id: 'auth', titleKey: 'authTitle', descKey: 'authDesc' },
  { id: 'links', titleKey: 'linksTitle', descKey: 'linksDesc' },
  { id: 'crm-contacts', titleKey: 'crmContactsTitle', descKey: 'crmContactsDesc' },
  { id: 'crm-companies', titleKey: 'crmCompaniesTitle', descKey: 'crmCompaniesDesc' },
  { id: 'crm-deals', titleKey: 'crmDealsTitle', descKey: 'crmDealsDesc' },
  { id: 'crm-activities', titleKey: 'crmActivitiesTitle', descKey: 'crmActivitiesDesc' },
  { id: 'crm-tasks', titleKey: 'crmTasksTitle', descKey: 'crmTasksDesc' },
  { id: 'crm-pipelines', titleKey: 'crmPipelinesTitle', descKey: 'crmPipelinesDesc' },
  { id: 'cal', titleKey: 'calTitle', descKey: 'calDesc' },
  { id: 'agents', titleKey: 'agentsTitle', descKey: 'agentsDesc' },
  { id: 'webhooks', titleKey: 'webhooksTitle', descKey: 'webhooksDesc' },
];

const BOOKING_EXAMPLE = {
  id: '8f1c2a8e-5b1e-4a7e-9a0e-2f6a1d0c9b11',
  status: 'confirmed',
  startsAt: '2026-11-03T13:00:00.000Z',
  endsAt: '2026-11-03T13:30:00.000Z',
  timezone: 'America/Argentina/Buenos_Aires',
  invitee: {
    name: 'Ana',
    email: 'ana@example.com'
  },
  answers: {},
  hostUserId: 'u_123',
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
  rescheduledFrom: null,
  cancelReason: null,
  eventType: {
    id: 'et_42',
    slug: 'intro',
    title: 'Intro call'
  }
};

export const API_ENDPOINTS: ApiEndpoint[] = [
  // Auth
  {
    id: 'auth-flow',
    sectionId: 'auth',
    method: 'GET',
    path: '/api/auth/signin/google',
    titleKey: 'authFlowTitle',
    descKey: 'authFlowDesc',
  },

  // Links
  {
    id: 'links-create',
    sectionId: 'links',
    method: 'POST',
    path: '/api/v1/links',
    titleKey: 'linksCreateTitle',
    descKey: 'linksCreateDesc',
    params: [
      { name: 'url', type: 'string', required: true, descriptionKey: 'paramLinkUrl' },
      { name: 'slug', type: 'string', descriptionKey: 'paramLinkSlug' },
      { name: 'title', type: 'string', descriptionKey: 'paramLinkTitle' },
      { name: 'tags', type: 'string[]', descriptionKey: 'paramLinkTags' },
    ],
    request: {
      url: 'https://zerosoft.ai/blog/software-is-dead',
      slug: 'manifesto',
      title: 'The manifesto',
      tags: ['launch', 'blog'],
    },
    response: {
      id: 'lnk_9f3ka2',
      slug: 'manifesto',
      short_url: 'https://zs.ai/manifesto',
      url: 'https://zerosoft.ai/blog/software-is-dead',
      title: 'The manifesto',
      tags: ['launch', 'blog'],
      created_at: '2026-07-14T18:22:41Z',
    },
    responseStatus: 201,
  },
  {
    id: 'links-list',
    sectionId: 'links',
    method: 'GET',
    path: '/api/v1/links',
    titleKey: 'linksListTitle',
    descKey: 'linksListDesc',
    params: [
      { name: 'page', type: 'integer', descriptionKey: 'paramPage' },
      { name: 'pageSize', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
    response: {
      links: [
        {
          id: 'lnk_9f3ka2',
          slug: 'manifesto',
          short_url: 'https://zs.ai/manifesto',
          url: 'https://zerosoft.ai/blog/software-is-dead',
          title: 'The manifesto',
          tags: ['launch', 'blog'],
          clicks: 4812,
          archived: false,
          created_at: '2026-07-14T18:22:41Z',
        },
      ],
      total: 48,
    },
    responseStatus: 200,
  },
  {
    id: 'links-delete',
    sectionId: 'links',
    method: 'DELETE',
    path: '/api/v1/links/{id}',
    titleKey: 'linksDeleteTitle',
    descKey: 'linksDeleteDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramLinkId' }],
    responseStatus: 204,
  },
  {
    id: 'links-patch',
    sectionId: 'links',
    method: 'PATCH',
    path: '/api/v1/links/{id}',
    titleKey: 'linksPatchTitle',
    descKey: 'linksPatchDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramLinkId' },
      { name: 'url', type: 'string', descriptionKey: 'paramLinkUrl' },
      { name: 'slug', type: 'string', descriptionKey: 'paramLinkSlug' },
      { name: 'title', type: 'string', descriptionKey: 'paramLinkTitle' },
      { name: 'tags', type: 'string[]', descriptionKey: 'paramLinkTags' },
      { name: 'archived', type: 'boolean', descriptionKey: 'paramLinkArchived' },
    ],
    request: { title: 'The manifesto — updated' },
    responseStatus: 200,
  },
  {
    id: 'links-stats',
    sectionId: 'links',
    method: 'GET',
    path: '/api/v1/links/{id}/stats',
    titleKey: 'linksStatsTitle',
    descKey: 'linksStatsDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramLinkId' }],
    response: {
      slug: 'manifesto',
      total: 4812,
      byDay: [
        { date: '2026-07-15', count: 412 },
        { date: '2026-07-16', count: 388 },
        { date: '2026-07-17', count: 441 },
      ],
    },
    responseStatus: 200,
  },

  // CRM Contacts — los requests van en camelCase; las respuestas devuelven
  // las columnas tal cual (snake_case).
  {
    id: 'contacts-list',
    sectionId: 'crm-contacts',
    method: 'GET',
    path: '/api/v1/crm/contacts',
    titleKey: 'contactsListTitle',
    descKey: 'contactsListDesc',
    params: [
      { name: 'q', type: 'string', descriptionKey: 'paramSearch' },
      { name: 'lifecycle', type: 'string', descriptionKey: 'paramLifecycleStage' },
      { name: 'page', type: 'integer', descriptionKey: 'paramPage' },
      { name: 'pageSize', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
    response: {
      contacts: [
        {
          id: 'b1f47ac2-…',
          first_name: 'Ana',
          last_name: 'Garcia',
          email: 'ana@kallpa.co',
          lifecycle_stage: 'sql',
          company_id: null,
          created_at: '2026-07-18 10:04:11',
        },
      ],
      total: 142,
      page: 1,
      pageSize: 25,
    },
    responseStatus: 200,
  },
  {
    id: 'contacts-create',
    sectionId: 'crm-contacts',
    method: 'POST',
    path: '/api/v1/crm/contacts',
    titleKey: 'contactsCreateTitle',
    descKey: 'contactsCreateDesc',
    params: [
      { name: 'firstName', type: 'string', descriptionKey: 'paramFirstName' },
      { name: 'lastName', type: 'string', descriptionKey: 'paramLastName' },
      { name: 'email', type: 'string', descriptionKey: 'paramEmail' },
      { name: 'lifecycleStage', type: 'string', descriptionKey: 'paramLifecycleStage' },
      { name: 'companyId', type: 'string', descriptionKey: 'paramCompanyId' },
    ],
    request: {
      firstName: 'Ana',
      lastName: 'Garcia',
      email: 'ana@kallpa.co',
      lifecycleStage: 'sql',
    },
    response: {
      id: 'b1f47ac2-…',
      first_name: 'Ana',
      last_name: 'Garcia',
      email: 'ana@kallpa.co',
      lifecycle_stage: 'sql',
      created_at: '2026-07-18 10:04:11',
    },
    responseStatus: 201,
  },
  {
    id: 'contacts-get',
    sectionId: 'crm-contacts',
    method: 'GET',
    path: '/api/v1/crm/contacts/{id}',
    titleKey: 'contactsGetTitle',
    descKey: 'contactsGetDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramId' }],
    responseStatus: 200,
  },
  {
    id: 'contacts-patch',
    sectionId: 'crm-contacts',
    method: 'PATCH',
    path: '/api/v1/crm/contacts/{id}',
    titleKey: 'contactsPatchTitle',
    descKey: 'contactsPatchDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramId' },
      { name: 'firstName', type: 'string', descriptionKey: 'paramFirstName' },
      { name: 'lifecycleStage', type: 'string', descriptionKey: 'paramLifecycleStage' },
      { name: 'companyId', type: 'string | null', descriptionKey: 'paramCompanyId' },
    ],
    request: { lifecycleStage: 'opportunity' },
    responseStatus: 200,
  },
  {
    id: 'contacts-delete',
    sectionId: 'crm-contacts',
    method: 'DELETE',
    path: '/api/v1/crm/contacts/{id}',
    titleKey: 'contactsDeleteTitle',
    descKey: 'contactsDeleteDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramId' }],
    responseStatus: 204,
  },

  // CRM Companies
  {
    id: 'companies-list',
    sectionId: 'crm-companies',
    method: 'GET',
    path: '/api/v1/crm/companies',
    titleKey: 'companiesListTitle',
    descKey: 'companiesListDesc',
    params: [
      { name: 'q', type: 'string', descriptionKey: 'paramSearch' },
      { name: 'page', type: 'integer', descriptionKey: 'paramPage' },
      { name: 'pageSize', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
    response: {
      companies: [{ id: 'c7a1…', name: 'Norte Labs', domain: 'nortelabs.co', industry: 'Software' }],
      total: 40,
      page: 1,
      pageSize: 25,
    },
    responseStatus: 200,
  },
  {
    id: 'companies-create',
    sectionId: 'crm-companies',
    method: 'POST',
    path: '/api/v1/crm/companies',
    titleKey: 'companiesCreateTitle',
    descKey: 'companiesCreateDesc',
    params: [
      { name: 'name', type: 'string', required: true, descriptionKey: 'paramCompanyName' },
      { name: 'domain', type: 'string', descriptionKey: 'paramCompanyDomain' },
      { name: 'industry', type: 'string', descriptionKey: 'paramCompanyIndustry' },
    ],
    request: { name: 'Norte Labs', domain: 'nortelabs.co', industry: 'Software' },
    responseStatus: 201,
  },
  {
    id: 'companies-get',
    sectionId: 'crm-companies',
    method: 'GET',
    path: '/api/v1/crm/companies/{id}',
    titleKey: 'companiesGetTitle',
    descKey: 'companiesGetDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramId' }],
    responseStatus: 200,
  },
  {
    id: 'companies-patch',
    sectionId: 'crm-companies',
    method: 'PATCH',
    path: '/api/v1/crm/companies/{id}',
    titleKey: 'companiesPatchTitle',
    descKey: 'companiesPatchDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramId' },
      { name: 'name', type: 'string', descriptionKey: 'paramCompanyName' },
      { name: 'domain', type: 'string', descriptionKey: 'paramCompanyDomain' },
      { name: 'industry', type: 'string', descriptionKey: 'paramCompanyIndustry' },
    ],
    request: { industry: 'Cloud infrastructure' },
    responseStatus: 200,
  },
  {
    id: 'companies-delete',
    sectionId: 'crm-companies',
    method: 'DELETE',
    path: '/api/v1/crm/companies/{id}',
    titleKey: 'companiesDeleteTitle',
    descKey: 'companiesDeleteDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramId' }],
    responseStatus: 204,
  },

  // CRM Deals
  {
    id: 'deals-list',
    sectionId: 'crm-deals',
    method: 'GET',
    path: '/api/v1/crm/deals',
    titleKey: 'dealsListTitle',
    descKey: 'dealsListDesc',
    params: [
      { name: 'pipelineId', type: 'string', descriptionKey: 'paramPipelineId' },
      { name: 'page', type: 'integer', descriptionKey: 'paramPage' },
      { name: 'pageSize', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
    response: {
      deals: [{ id: 'd9e2…', name: 'Norte Labs — New business', amount: 24000, currency: 'USD', stage_id: '{stage_id}' }],
      total: 36,
      page: 1,
      pageSize: 25,
    },
    responseStatus: 200,
  },
  {
    id: 'deals-create',
    sectionId: 'crm-deals',
    method: 'POST',
    path: '/api/v1/crm/deals',
    titleKey: 'dealsCreateTitle',
    descKey: 'dealsCreateDesc',
    params: [
      { name: 'pipelineId', type: 'string', required: true, descriptionKey: 'paramPipelineId' },
      { name: 'stageId', type: 'string', required: true, descriptionKey: 'paramStageId' },
      { name: 'name', type: 'string', descriptionKey: 'paramDealName' },
      { name: 'amount', type: 'number', descriptionKey: 'paramDealAmount' },
      { name: 'currency', type: 'string', descriptionKey: 'paramDealCurrency' },
      { name: 'contactIds', type: 'string[]', descriptionKey: 'paramContactIds' },
    ],
    request: {
      pipelineId: '{pipeline_id}',
      stageId: '{stage_id}',
      name: 'Norte Labs — New business',
      amount: 24000,
      currency: 'USD',
      contactIds: ['{contact_id}'],
    },
    responseStatus: 201,
  },
  {
    id: 'deals-get',
    sectionId: 'crm-deals',
    method: 'GET',
    path: '/api/v1/crm/deals/{id}',
    titleKey: 'dealsGetTitle',
    descKey: 'dealsGetDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramId' }],
    responseStatus: 200,
  },
  {
    id: 'deals-patch',
    sectionId: 'crm-deals',
    method: 'PATCH',
    path: '/api/v1/crm/deals/{id}',
    titleKey: 'dealsPatchTitle',
    descKey: 'dealsPatchDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramId' },
      { name: 'name', type: 'string', descriptionKey: 'paramDealName' },
      { name: 'amount', type: 'number', descriptionKey: 'paramDealAmount' },
      { name: 'addContactIds', type: 'string[]', descriptionKey: 'paramContactIds' },
    ],
    request: { amount: 28000, closeDate: '2026-11-30' },
    responseStatus: 200,
  },
  {
    id: 'deals-move',
    sectionId: 'crm-deals',
    method: 'POST',
    path: '/api/v1/crm/deals/{id}/move',
    titleKey: 'dealsMoveTitle',
    descKey: 'dealsMoveDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramId' },
      { name: 'stageId', type: 'string', required: true, descriptionKey: 'paramStageId' },
      { name: 'lostReason', type: 'string', descriptionKey: 'paramLostReason' },
    ],
    request: { stageId: '{stage_id}' },
    responseStatus: 200,
  },
  {
    id: 'deals-delete',
    sectionId: 'crm-deals',
    method: 'DELETE',
    path: '/api/v1/crm/deals/{id}',
    titleKey: 'dealsDeleteTitle',
    descKey: 'dealsDeleteDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramId' }],
    responseStatus: 204,
  },

  // CRM Activities (timeline)
  {
    id: 'activities-list',
    sectionId: 'crm-activities',
    method: 'GET',
    path: '/api/v1/crm/activities',
    titleKey: 'activitiesListTitle',
    descKey: 'activitiesListDesc',
    params: [
      { name: 'contactId | companyId | dealId', type: 'string', required: true, descriptionKey: 'paramRecordFilter' },
      { name: 'type', type: 'note | task | call | meeting | email', descriptionKey: 'paramActivityType' },
      { name: 'limit', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
    response: {
      activities: [
        { id: 'a12…', type: 'meeting', subject: 'Intro call', due_at: '2026-11-03 13:00:00', duration_min: 30, contact_id: '{contact_id}' },
      ],
    },
    responseStatus: 200,
  },
  {
    id: 'activities-create',
    sectionId: 'crm-activities',
    method: 'POST',
    path: '/api/v1/crm/activities',
    titleKey: 'activitiesCreateTitle',
    descKey: 'activitiesCreateDesc',
    params: [
      { name: 'type', type: 'note | call | meeting | email', required: true, descriptionKey: 'paramActivityType' },
      { name: 'subject', type: 'string', descriptionKey: 'paramTaskSubject' },
      { name: 'body', type: 'string', descriptionKey: 'paramActivityBody' },
      { name: 'contactId', type: 'string', descriptionKey: 'paramContactId' },
      { name: 'dealId', type: 'string', descriptionKey: 'paramDealId' },
    ],
    request: { type: 'call', subject: 'Discovery call', body: 'Budget approved for Q1.', durationMin: 25, contactId: '{contact_id}' },
    responseStatus: 201,
  },

  // CRM Tasks
  {
    id: 'tasks-list',
    sectionId: 'crm-tasks',
    method: 'GET',
    path: '/api/v1/crm/tasks',
    titleKey: 'tasksListTitle',
    descKey: 'tasksListDesc',
    params: [
      { name: 'bucket', type: 'overdue | today | upcoming | done', descriptionKey: 'paramTaskBucket' },
      { name: 'page', type: 'integer', descriptionKey: 'paramPage' },
      { name: 'pageSize', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
    responseStatus: 200,
  },
  {
    id: 'tasks-create',
    sectionId: 'crm-tasks',
    method: 'POST',
    path: '/api/v1/crm/tasks',
    titleKey: 'tasksCreateTitle',
    descKey: 'tasksCreateDesc',
    params: [
      { name: 'subject', type: 'string', required: true, descriptionKey: 'paramTaskSubject' },
      { name: 'dueAt', type: 'string (ISO 8601)', descriptionKey: 'paramTaskDueAt' },
      { name: 'contactId', type: 'string', descriptionKey: 'paramContactId' },
      { name: 'companyId', type: 'string', descriptionKey: 'paramCompanyId' },
      { name: 'dealId', type: 'string', descriptionKey: 'paramDealId' },
    ],
    request: { subject: 'Follow-up call', dueAt: '2026-07-25T15:00:00Z', dealId: '{deal_id}' },
    responseStatus: 201,
  },
  {
    id: 'tasks-patch',
    sectionId: 'crm-tasks',
    method: 'PATCH',
    path: '/api/v1/crm/tasks/{id}',
    titleKey: 'tasksPatchTitle',
    descKey: 'tasksPatchDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramId' },
      { name: 'subject', type: 'string', descriptionKey: 'paramTaskSubject' },
      { name: 'done', type: 'boolean', descriptionKey: 'paramTaskDone' },
    ],
    request: { done: true },
    responseStatus: 200,
  },

  // CRM Pipelines & Stages
  {
    id: 'pipelines-list',
    sectionId: 'crm-pipelines',
    method: 'GET',
    path: '/api/v1/crm/pipelines',
    titleKey: 'pipelinesListTitle',
    descKey: 'pipelinesListDesc',
    response: {
      pipelines: [
        {
          id: '{pipeline_id}',
          name: 'Sales',
          position: 0,
          stages: [
            { id: '{stage_id}', name: 'Qualified', position: 0, probability: 20, isWon: false, isLost: false },
            { id: '{stage_id}', name: 'Won', position: 5, probability: 100, isWon: true, isLost: false },
          ],
        },
      ],
    },
    responseStatus: 200,
  },

  // Cal
  {
    id: 'cal-event-types',
    sectionId: 'cal',
    method: 'GET',
    path: '/api/v1/calendar/event-types',
    titleKey: 'calEventTypesTitle',
    descKey: 'calEventTypesDesc',
    response: {
      eventTypes: [
        { id: 'et_42', slug: 'intro', title: 'Intro call', durationMin: 30, active: true, url: 'https://zerosoft.ai/en/book/ana/intro' },
      ],
    },
    responseStatus: 200,
  },
  {
    id: 'cal-bookings-list',
    sectionId: 'cal',
    method: 'GET',
    path: '/api/v1/calendar/bookings',
    titleKey: 'calBookingsListTitle',
    descKey: 'calBookingsListDesc',
    params: [
      { name: 'status', type: 'confirmed | cancelled | no_show', descriptionKey: 'paramCalStatus' },
      { name: 'from', type: 'ISO 8601', descriptionKey: 'paramCalFrom' },
      { name: 'to', type: 'ISO 8601', descriptionKey: 'paramCalTo' },
    ],
    response: { bookings: [BOOKING_EXAMPLE] },
    responseStatus: 200,
  },
  {
    id: 'cal-bookings-create',
    sectionId: 'cal',
    method: 'POST',
    path: '/api/v1/calendar/bookings',
    titleKey: 'calBookingsCreateTitle',
    descKey: 'calBookingsCreateDesc',
    params: [
      { name: 'eventTypeId', type: 'string', required: true, descriptionKey: 'paramCalEventTypeId' },
      { name: 'start', type: 'ISO 8601', required: true, descriptionKey: 'paramCalStart' },
      { name: 'name', type: 'string', required: true, descriptionKey: 'paramCalName' },
      { name: 'email', type: 'string', required: true, descriptionKey: 'paramCalEmail' },
      { name: 'timezone', type: 'IANA', descriptionKey: 'paramCalTimezone' },
    ],
    request: { eventTypeId: 'et_42', start: '2026-11-03T13:00:00.000Z', name: 'Ana', email: 'ana@example.com', timezone: 'America/Argentina/Buenos_Aires' },
    response: BOOKING_EXAMPLE,
    responseStatus: 201,
  },
  {
    id: 'cal-bookings-get',
    sectionId: 'cal',
    method: 'GET',
    path: '/api/v1/calendar/bookings/:id',
    titleKey: 'calBookingsGetTitle',
    descKey: 'calBookingsGetDesc',
    response: BOOKING_EXAMPLE,
    responseStatus: 200,
  },
  {
    id: 'cal-bookings-cancel',
    sectionId: 'cal',
    method: 'POST',
    path: '/api/v1/calendar/bookings/:id/cancel',
    titleKey: 'calBookingsCancelTitle',
    descKey: 'calBookingsCancelDesc',
    params: [{ name: 'reason', type: 'string', descriptionKey: 'paramCalReason' }],
    request: { reason: 'Customer asked to move it to next month' },
    response: { ...BOOKING_EXAMPLE, status: 'cancelled', cancelReason: 'Customer asked to move it to next month' },
    responseStatus: 200,
  },

  // Agents
  {
    id: 'agents-messages',
    sectionId: 'agents',
    method: 'POST',
    path: '/api/v1/agents/:id/messages',
    titleKey: 'agentsMessagesTitle',
    descKey: 'agentsMessagesDesc',
    params: [
      { name: 'message', type: 'string', required: true, descriptionKey: 'paramAgentMessage' },
      { name: 'conversationId', type: 'string', descriptionKey: 'paramAgentConversationId' },
    ],
    request: { message: 'Do you ship to Brazil?' },
    response: {
      conversationId: '6b0f8f7e-2a43-4d0c-9a51-3f3c1f1b8e21',
      message: { id: 'b7e1…', role: 'assistant', content: 'Yes! We ship to Brazil in 5–7 business days.', createdAt: '2026-11-01T18:00:00.000Z' },
      status: 'replied',
      handoff: false,
      toolCalls: [{ tool: 'search_knowledge', input: { query: 'shipping Brazil' }, output: { results: [] }, error: null }],
    },
    responseStatus: 200,
  },

  // Webhooks
  {
    id: 'webhooks-payload',
    sectionId: 'webhooks',
    method: 'POST',
    path: 'https://your-app.example/webhooks/zerosoft',
    titleKey: 'webhooksPayloadTitle',
    descKey: 'webhooksPayloadDesc',
    request: { id: 'evt_1', type: 'booking.created', createdAt: '2026-11-01T18:00:00.000Z', data: BOOKING_EXAMPLE },
  },
];
