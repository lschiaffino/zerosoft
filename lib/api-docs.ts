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
  { id: 'crm-tasks', titleKey: 'crmTasksTitle', descKey: 'crmTasksDesc' },
  { id: 'crm-pipelines', titleKey: 'crmPipelinesTitle', descKey: 'crmPipelinesDesc' },
  { id: 'teams', titleKey: 'teamsTitle', descKey: 'teamsDesc' },
  { id: 'docs', titleKey: 'docsTitle', descKey: 'docsDesc' },
];

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
    response: { ok: true },
    responseStatus: 200,
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
    response: { ok: true },
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

  // CRM Contacts
  {
    id: 'contacts-list',
    sectionId: 'crm-contacts',
    method: 'GET',
    path: '/api/v1/crm/contacts',
    titleKey: 'contactsListTitle',
    descKey: 'contactsListDesc',
    params: [
      { name: 'q', type: 'string', descriptionKey: 'paramSearch' },
      { name: 'page', type: 'integer', descriptionKey: 'paramPage' },
      { name: 'pageSize', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
    response: {
      rows: [
        {
          id: 'b1f47ac2-…',
          first_name: 'Ana',
          last_name: 'Garcia',
          email: 'ana@kallpa.co',
          lifecycle_stage: 'sql',
          created_at: '2026-07-18 10:04:11',
        },
      ],
      total: 142,
      page: 1,
      pageSize: 10,
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
      { name: 'first_name', type: 'string', descriptionKey: 'paramFirstName' },
      { name: 'last_name', type: 'string', descriptionKey: 'paramLastName' },
      { name: 'email', type: 'string', descriptionKey: 'paramEmail' },
      { name: 'lifecycle_stage', type: 'string', descriptionKey: 'paramLifecycleStage' },
    ],
    request: {
      first_name: 'Ana',
      last_name: 'Garcia',
      email: 'ana@kallpa.co',
      lifecycle_stage: 'sql',
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
      { name: 'first_name', type: 'string', descriptionKey: 'paramFirstName' },
      { name: 'last_name', type: 'string', descriptionKey: 'paramLastName' },
      { name: 'email', type: 'string', descriptionKey: 'paramEmail' },
    ],
    request: { lifecycle_stage: 'opportunity' },
    responseStatus: 200,
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
    ],
    request: { industry: 'Cloud infrastructure' },
    responseStatus: 200,
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
      { name: 'q', type: 'string', descriptionKey: 'paramSearch' },
      { name: 'page', type: 'integer', descriptionKey: 'paramPage' },
      { name: 'pageSize', type: 'integer', descriptionKey: 'paramPageSize' },
    ],
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
      { name: 'name', type: 'string', required: true, descriptionKey: 'paramDealName' },
      { name: 'amount', type: 'number', descriptionKey: 'paramDealAmount' },
      { name: 'currency', type: 'string', descriptionKey: 'paramDealCurrency' },
      { name: 'stage_id', type: 'string', required: true, descriptionKey: 'paramStageId' },
    ],
    request: { name: 'Norte Labs — New business', amount: 24000, currency: 'USD', stage_id: '{stage_id}' },
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
      { name: 'stage_id', type: 'string', descriptionKey: 'paramStageId' },
    ],
    request: { amount: 28000 },
    responseStatus: 200,
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
      { name: 'bucket', type: 'string', descriptionKey: 'paramTaskBucket' },
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
      { name: 'due_at', type: 'string (ISO)', descriptionKey: 'paramTaskDueAt' },
      { name: 'contact_id', type: 'string', descriptionKey: 'paramContactId' },
      { name: 'company_id', type: 'string', descriptionKey: 'paramCompanyId' },
      { name: 'deal_id', type: 'string', descriptionKey: 'paramDealId' },
    ],
    request: { subject: 'Follow-up call', due_at: '2026-07-25T15:00:00Z', deal_id: '{deal_id}' },
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
    path: '/api/crm/pipelines',
    titleKey: 'pipelinesListTitle',
    descKey: 'pipelinesListDesc',
    responseStatus: 200,
  },
  {
    id: 'pipelines-create',
    sectionId: 'crm-pipelines',
    method: 'POST',
    path: '/api/crm/pipelines',
    titleKey: 'pipelinesCreateTitle',
    descKey: 'pipelinesCreateDesc',
    params: [{ name: 'name', type: 'string', required: true, descriptionKey: 'paramPipelineName' }],
    request: { name: 'Sales' },
    responseStatus: 201,
  },
  {
    id: 'stages-list',
    sectionId: 'crm-pipelines',
    method: 'GET',
    path: '/api/crm/pipelines/{id}/stages',
    titleKey: 'stagesListTitle',
    descKey: 'stagesListDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramPipelineId' }],
    responseStatus: 200,
  },
  {
    id: 'stages-create',
    sectionId: 'crm-pipelines',
    method: 'POST',
    path: '/api/crm/pipelines/{id}/stages',
    titleKey: 'stagesCreateTitle',
    descKey: 'stagesCreateDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramPipelineId' },
      { name: 'name', type: 'string', required: true, descriptionKey: 'paramStageName' },
      { name: 'probability', type: 'integer', descriptionKey: 'paramStageProbability' },
    ],
    request: { name: 'Proposal', probability: 50 },
    responseStatus: 201,
  },

  // Teams
  {
    id: 'teams-invite',
    sectionId: 'teams',
    method: 'POST',
    path: '/api/teams/invites',
    titleKey: 'teamsInviteTitle',
    descKey: 'teamsInviteDesc',
    params: [
      { name: 'teamId', type: 'string', required: true, descriptionKey: 'paramTeamId' },
      { name: 'email', type: 'string', required: true, descriptionKey: 'paramInviteEmail' },
    ],
    request: { teamId: '{team_id}', email: 'teammate@company.com' },
    response: { invite: { id: 'inv_…', token: '…' }, url: 'https://zerosoft.ai/en/invite/…' },
    responseStatus: 201,
  },
  {
    id: 'teams-accept',
    sectionId: 'teams',
    method: 'POST',
    path: '/api/teams/accept',
    titleKey: 'teamsAcceptTitle',
    descKey: 'teamsAcceptDesc',
    params: [{ name: 'token', type: 'string', required: true, descriptionKey: 'paramInviteToken' }],
    request: { token: '{invite_token}' },
    response: { ok: true, team: { id: '{team_id}', name: 'Norte Labs' } },
    responseStatus: 200,
  },
  {
    id: 'teams-switch',
    sectionId: 'teams',
    method: 'POST',
    path: '/api/teams/switch',
    titleKey: 'teamsSwitchTitle',
    descKey: 'teamsSwitchDesc',
    params: [{ name: 'teamId', type: 'string | null', descriptionKey: 'paramTeamIdSwitch' }],
    request: { teamId: '{team_id}' },
    response: { ok: true },
    responseStatus: 200,
  },

  // Docs
  {
    id: 'docs-list',
    sectionId: 'docs',
    method: 'GET',
    path: '/api/docs/pages',
    titleKey: 'docsListTitle',
    descKey: 'docsListDesc',
    response: {
      rows: [{ id: 'page_…', title: 'Wiki home', parent_id: null, updated_at: '2026-07-18T12:00:00Z' }],
    },
    responseStatus: 200,
  },
  {
    id: 'docs-create',
    sectionId: 'docs',
    method: 'POST',
    path: '/api/docs/pages',
    titleKey: 'docsCreateTitle',
    descKey: 'docsCreateDesc',
    params: [
      { name: 'title', type: 'string', required: true, descriptionKey: 'paramDocTitle' },
      { name: 'parent_id', type: 'string', descriptionKey: 'paramDocParentId' },
      { name: 'content', type: 'DocsBlock[]', descriptionKey: 'paramDocContent' },
    ],
    request: { title: 'Onboarding', parent_id: null, content: [] },
    responseStatus: 201,
  },
  {
    id: 'docs-get',
    sectionId: 'docs',
    method: 'GET',
    path: '/api/docs/pages/{id}',
    titleKey: 'docsGetTitle',
    descKey: 'docsGetDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramDocId' }],
    responseStatus: 200,
  },
  {
    id: 'docs-patch',
    sectionId: 'docs',
    method: 'PATCH',
    path: '/api/docs/pages/{id}',
    titleKey: 'docsPatchTitle',
    descKey: 'docsPatchDesc',
    params: [
      { name: 'id', type: 'string', required: true, descriptionKey: 'paramDocId' },
      { name: 'title', type: 'string', descriptionKey: 'paramDocTitle' },
      { name: 'content', type: 'DocsBlock[]', descriptionKey: 'paramDocContent' },
      { name: 'archived', type: 'boolean', descriptionKey: 'paramDocArchived' },
    ],
    request: { title: 'Onboarding v2' },
    responseStatus: 200,
  },
  {
    id: 'docs-delete',
    sectionId: 'docs',
    method: 'DELETE',
    path: '/api/docs/pages/{id}',
    titleKey: 'docsDeleteTitle',
    descKey: 'docsDeleteDesc',
    params: [{ name: 'id', type: 'string', required: true, descriptionKey: 'paramDocId' }],
    response: { ok: true },
    responseStatus: 200,
  },
];
