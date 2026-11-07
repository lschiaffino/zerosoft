// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/v1/agents/[id]/messages/route";
import * as r1 from "@/app/api/v1/boards/route";
import * as r2 from "@/lib/routes/v1/boards/[id]/route";
import * as r3 from "@/lib/routes/v1/boards/[id]/elements/route";
import * as r4 from "@/app/api/v1/books/invoices/route";
import * as r5 from "@/app/api/v1/calendar/bookings/route";
import * as r6 from "@/lib/routes/v1/calendar/bookings/[id]/route";
import * as r7 from "@/lib/routes/v1/calendar/bookings/[id]/cancel/route";
import * as r8 from "@/lib/routes/v1/calendar/bookings/[id]/no-show/route";
import * as r9 from "@/lib/routes/v1/calendar/bookings/[id]/reschedule/route";
import * as r10 from "@/app/api/v1/calendar/event-types/route";
import * as r11 from "@/app/api/v1/chat/conversations/route";
import * as r12 from "@/lib/routes/v1/chat/conversations/[id]/route";
import * as r13 from "@/lib/routes/v1/chat/conversations/[id]/assign/route";
import * as r14 from "@/lib/routes/v1/chat/conversations/[id]/messages/route";
import * as r15 from "@/lib/routes/v1/chat/conversations/[id]/reopen/route";
import * as r16 from "@/lib/routes/v1/chat/conversations/[id]/resolve/route";
import * as r17 from "@/app/api/v1/crm/activities/route";
import * as r18 from "@/app/api/v1/crm/associations/route";
import * as r19 from "@/app/api/v1/crm/companies/route";
import * as r20 from "@/lib/routes/v1/crm/companies/[id]/route";
import * as r21 from "@/app/api/v1/crm/contacts/route";
import * as r22 from "@/lib/routes/v1/crm/contacts/[id]/route";
import * as r23 from "@/app/api/v1/crm/deals/route";
import * as r24 from "@/lib/routes/v1/crm/deals/[id]/route";
import * as r25 from "@/lib/routes/v1/crm/deals/[id]/line-items/route";
import * as r26 from "@/lib/routes/v1/crm/deals/[id]/line-items/[itemId]/route";
import * as r27 from "@/lib/routes/v1/crm/deals/[id]/move/route";
import * as r28 from "@/app/api/v1/crm/email-templates/route";
import * as r29 from "@/lib/routes/v1/crm/email-templates/[id]/route";
import * as r30 from "@/app/api/v1/crm/extension/log-email/route";
import * as r31 from "@/app/api/v1/crm/extension/me/route";
import * as r32 from "@/app/api/v1/crm/extension/sidebar/route";
import * as r33 from "@/app/api/v1/crm/extension/templates/route";
import * as r34 from "@/app/api/v1/crm/extension/track/route";
import * as r35 from "@/app/api/v1/crm/forms/route";
import * as r36 from "@/lib/routes/v1/crm/forms/[id]/submissions/route";
import * as r37 from "@/app/api/v1/crm/leads/route";
import * as r38 from "@/lib/routes/v1/crm/leads/[id]/route";
import * as r39 from "@/app/api/v1/crm/objects/route";
import * as r40 from "@/lib/routes/v1/crm/objects/[slug]/records/route";
import * as r41 from "@/lib/routes/v1/crm/objects/[slug]/records/[id]/route";
import * as r42 from "@/app/api/v1/crm/pipelines/route";
import * as r43 from "@/app/api/v1/crm/products/route";
import * as r44 from "@/lib/routes/v1/crm/products/[id]/route";
import * as r45 from "@/app/api/v1/crm/quotes/route";
import * as r46 from "@/lib/routes/v1/crm/quotes/[id]/route";
import * as r47 from "@/app/api/v1/crm/sequences/route";
import * as r48 from "@/lib/routes/v1/crm/sequences/[id]/enroll/route";
import * as r49 from "@/lib/routes/v1/crm/sequences/[id]/unenroll/route";
import * as r50 from "@/app/api/v1/crm/tags/route";
import * as r51 from "@/lib/routes/v1/crm/tags/[id]/route";
import * as r52 from "@/lib/routes/v1/crm/tags/[id]/records/route";
import * as r53 from "@/app/api/v1/crm/tasks/route";
import * as r54 from "@/lib/routes/v1/crm/tasks/[id]/route";
import * as r55 from "@/app/api/v1/design/route";
import * as r56 from "@/app/api/v1/docs/databases/route";
import * as r57 from "@/lib/routes/v1/docs/databases/[pageId]/[blockId]/route";
import * as r58 from "@/lib/routes/v1/docs/databases/[pageId]/[blockId]/rows/route";
import * as r59 from "@/lib/routes/v1/docs/databases/[pageId]/[blockId]/rows/[rowId]/route";
import * as r60 from "@/app/api/v1/docs/pages/route";
import * as r61 from "@/lib/routes/v1/docs/pages/[id]/route";
import * as r62 from "@/lib/routes/v1/docs/pages/[id]/blocks/route";
import * as r63 from "@/lib/routes/v1/docs/pages/[id]/comments/route";
import * as r64 from "@/app/api/v1/docs/search/route";
import * as r65 from "@/app/api/v1/forms/forms/route";
import * as r66 from "@/app/api/v1/forms/responses/route";
import * as r67 from "@/app/api/v1/groups/broadcasts/route";
import * as r68 from "@/app/api/v1/groups/chats/route";
import * as r69 from "@/lib/routes/v1/groups/chats/[id]/route";
import * as r70 from "@/lib/routes/v1/groups/chats/[id]/members/route";
import * as r71 from "@/lib/routes/v1/groups/chats/[id]/messages/route";
import * as r72 from "@/app/api/v1/groups/groups/route";
import * as r73 from "@/app/api/v1/groups/labels/route";
import * as r74 from "@/app/api/v1/groups/numbers/route";
import * as r75 from "@/app/api/v1/groups/recurring/route";
import * as r76 from "@/app/api/v1/groups/tickets/route";
import * as r77 from "@/lib/routes/v1/groups/tickets/[id]/route";
import * as r78 from "@/app/api/v1/hiring/candidates/route";
import * as r79 from "@/app/api/v1/hiring/jobs/route";
import * as r80 from "@/app/api/v1/links/route";
import * as r81 from "@/lib/routes/v1/links/[id]/route";
import * as r82 from "@/lib/routes/v1/links/[id]/stats/route";
import * as r83 from "@/app/api/v1/links/analytics/route";
import * as r84 from "@/app/api/v1/links/track/lead/route";
import * as r85 from "@/app/api/v1/links/track/sale/route";
import * as r86 from "@/app/api/v1/notes/route";
import * as r87 from "@/lib/routes/v1/notes/[id]/route";
import * as r88 from "@/app/api/v1/notes/notebooks/route";
import * as r89 from "@/app/api/v1/people/employees/route";
import * as r90 from "@/app/api/v1/robots/route";
import * as r91 from "@/lib/routes/v1/robots/[id]/bulk/route";
import * as r92 from "@/app/api/v1/robots/[id]/runs/route";
import * as r93 from "@/lib/routes/v1/robots/batches/[id]/route";
import * as r94 from "@/lib/routes/v1/robots/runs/[id]/route";
import * as r95 from "@/app/api/v1/send/documents/route";
import * as r96 from "@/app/api/v1/shop/orders/route";
import * as r97 from "@/app/api/v1/shop/products/route";
import * as r98 from "@/app/api/v1/sign/envelopes/route";
import * as r99 from "@/app/api/v1/social/posts/route";
import * as r100 from "@/app/api/v1/talk/channels/route";
import * as r101 from "@/app/api/v1/talk/messages/route";
import * as r102 from "@/app/api/v1/track/issues/route";
import * as r103 from "@/lib/routes/v1/track/issues/[id]/route";
import * as r104 from "@/lib/routes/v1/track/issues/[id]/comments/route";
import * as r105 from "@/app/api/v1/track/labels/route";
import * as r106 from "@/app/api/v1/track/projects/route";
import * as r107 from "@/lib/routes/v1/track/projects/[id]/route";
import * as r108 from "@/lib/routes/v1/track/projects/[id]/cycles/route";
import * as r109 from "@/lib/routes/v1/track/projects/[id]/statuses/route";
import * as r110 from "@/app/api/v1/track/requests/route";
import * as r111 from "@/app/api/v1/track/teams/route";
import * as r112 from "@/lib/routes/v1/track/teams/[id]/route";
import * as r113 from "@/lib/routes/v1/track/teams/[id]/cycles/route";
import * as r114 from "@/lib/routes/v1/track/teams/[id]/statuses/route";
import * as r115 from "@/app/api/v1/track/users/route";
import * as r116 from "@/app/api/v1/voice/dictate/route";
import * as r117 from "@/app/api/v1/voice/dictionary/route";
import * as r118 from "@/app/api/v1/voice/sessions/route";
import * as r119 from "@/lib/routes/v1/voice/sessions/[id]/route";
import * as r120 from "@/app/api/v1/voice/sessions/[id]/chunks/route";

export const routes: Record<string, unknown> = {
  "/api/v1/agents/[id]/messages": r0,
  "/api/v1/boards": r1,
  "/api/v1/boards/[id]": r2,
  "/api/v1/boards/[id]/elements": r3,
  "/api/v1/books/invoices": r4,
  "/api/v1/calendar/bookings": r5,
  "/api/v1/calendar/bookings/[id]": r6,
  "/api/v1/calendar/bookings/[id]/cancel": r7,
  "/api/v1/calendar/bookings/[id]/no-show": r8,
  "/api/v1/calendar/bookings/[id]/reschedule": r9,
  "/api/v1/calendar/event-types": r10,
  "/api/v1/chat/conversations": r11,
  "/api/v1/chat/conversations/[id]": r12,
  "/api/v1/chat/conversations/[id]/assign": r13,
  "/api/v1/chat/conversations/[id]/messages": r14,
  "/api/v1/chat/conversations/[id]/reopen": r15,
  "/api/v1/chat/conversations/[id]/resolve": r16,
  "/api/v1/crm/activities": r17,
  "/api/v1/crm/associations": r18,
  "/api/v1/crm/companies": r19,
  "/api/v1/crm/companies/[id]": r20,
  "/api/v1/crm/contacts": r21,
  "/api/v1/crm/contacts/[id]": r22,
  "/api/v1/crm/deals": r23,
  "/api/v1/crm/deals/[id]": r24,
  "/api/v1/crm/deals/[id]/line-items": r25,
  "/api/v1/crm/deals/[id]/line-items/[itemId]": r26,
  "/api/v1/crm/deals/[id]/move": r27,
  "/api/v1/crm/email-templates": r28,
  "/api/v1/crm/email-templates/[id]": r29,
  "/api/v1/crm/extension/log-email": r30,
  "/api/v1/crm/extension/me": r31,
  "/api/v1/crm/extension/sidebar": r32,
  "/api/v1/crm/extension/templates": r33,
  "/api/v1/crm/extension/track": r34,
  "/api/v1/crm/forms": r35,
  "/api/v1/crm/forms/[id]/submissions": r36,
  "/api/v1/crm/leads": r37,
  "/api/v1/crm/leads/[id]": r38,
  "/api/v1/crm/objects": r39,
  "/api/v1/crm/objects/[slug]/records": r40,
  "/api/v1/crm/objects/[slug]/records/[id]": r41,
  "/api/v1/crm/pipelines": r42,
  "/api/v1/crm/products": r43,
  "/api/v1/crm/products/[id]": r44,
  "/api/v1/crm/quotes": r45,
  "/api/v1/crm/quotes/[id]": r46,
  "/api/v1/crm/sequences": r47,
  "/api/v1/crm/sequences/[id]/enroll": r48,
  "/api/v1/crm/sequences/[id]/unenroll": r49,
  "/api/v1/crm/tags": r50,
  "/api/v1/crm/tags/[id]": r51,
  "/api/v1/crm/tags/[id]/records": r52,
  "/api/v1/crm/tasks": r53,
  "/api/v1/crm/tasks/[id]": r54,
  "/api/v1/design": r55,
  "/api/v1/docs/databases": r56,
  "/api/v1/docs/databases/[pageId]/[blockId]": r57,
  "/api/v1/docs/databases/[pageId]/[blockId]/rows": r58,
  "/api/v1/docs/databases/[pageId]/[blockId]/rows/[rowId]": r59,
  "/api/v1/docs/pages": r60,
  "/api/v1/docs/pages/[id]": r61,
  "/api/v1/docs/pages/[id]/blocks": r62,
  "/api/v1/docs/pages/[id]/comments": r63,
  "/api/v1/docs/search": r64,
  "/api/v1/forms/forms": r65,
  "/api/v1/forms/responses": r66,
  "/api/v1/groups/broadcasts": r67,
  "/api/v1/groups/chats": r68,
  "/api/v1/groups/chats/[id]": r69,
  "/api/v1/groups/chats/[id]/members": r70,
  "/api/v1/groups/chats/[id]/messages": r71,
  "/api/v1/groups/groups": r72,
  "/api/v1/groups/labels": r73,
  "/api/v1/groups/numbers": r74,
  "/api/v1/groups/recurring": r75,
  "/api/v1/groups/tickets": r76,
  "/api/v1/groups/tickets/[id]": r77,
  "/api/v1/hiring/candidates": r78,
  "/api/v1/hiring/jobs": r79,
  "/api/v1/links": r80,
  "/api/v1/links/[id]": r81,
  "/api/v1/links/[id]/stats": r82,
  "/api/v1/links/analytics": r83,
  "/api/v1/links/track/lead": r84,
  "/api/v1/links/track/sale": r85,
  "/api/v1/notes": r86,
  "/api/v1/notes/[id]": r87,
  "/api/v1/notes/notebooks": r88,
  "/api/v1/people/employees": r89,
  "/api/v1/robots": r90,
  "/api/v1/robots/[id]/bulk": r91,
  "/api/v1/robots/[id]/runs": r92,
  "/api/v1/robots/batches/[id]": r93,
  "/api/v1/robots/runs/[id]": r94,
  "/api/v1/send/documents": r95,
  "/api/v1/shop/orders": r96,
  "/api/v1/shop/products": r97,
  "/api/v1/sign/envelopes": r98,
  "/api/v1/social/posts": r99,
  "/api/v1/talk/channels": r100,
  "/api/v1/talk/messages": r101,
  "/api/v1/track/issues": r102,
  "/api/v1/track/issues/[id]": r103,
  "/api/v1/track/issues/[id]/comments": r104,
  "/api/v1/track/labels": r105,
  "/api/v1/track/projects": r106,
  "/api/v1/track/projects/[id]": r107,
  "/api/v1/track/projects/[id]/cycles": r108,
  "/api/v1/track/projects/[id]/statuses": r109,
  "/api/v1/track/requests": r110,
  "/api/v1/track/teams": r111,
  "/api/v1/track/teams/[id]": r112,
  "/api/v1/track/teams/[id]/cycles": r113,
  "/api/v1/track/teams/[id]/statuses": r114,
  "/api/v1/track/users": r115,
  "/api/v1/voice/dictate": r116,
  "/api/v1/voice/dictionary": r117,
  "/api/v1/voice/sessions": r118,
  "/api/v1/voice/sessions/[id]": r119,
  "/api/v1/voice/sessions/[id]/chunks": r120,
};
