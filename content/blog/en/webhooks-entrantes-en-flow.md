---
title: "Incoming webhooks in Flow: receive, protect and reply"
description: "How to build a URL that other services call: method, header authentication, reading the body, replying with your own status code, and the limits that exist today."
date: "2026-10-23"
author: "zerosoft"
tags: ["flow", "webhooks", "automation"]
---

An incoming webhook is a URL you hand to another service so it can tell you when something happens: a submitted form, a payment, a push to a repository. On your side, a flow starts by itself. It is the most used trigger in any automation tool, and the one most often set up carelessly, because the URL sits on the public internet.

n8n handles this with a Webhook node that has two addresses, a test one and a production one, as described in the [node documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/). The test URL only listens while you are watching the editor. The production URL is registered when you activate the workflow. Flow has a single URL per trigger, and what you do with it comes down to four settings. Here they are, with examples you can copy.

## 1. Create the trigger and copy the URL

In Flow, create a new flow and pick **Incoming webhook** as the trigger. Save it: only then does the URL appear, shaped like this:

```
https://your-domain/api/flow/hooks/fh_xxxxxxxxxxxxxxxxxxxx
```

The token after `fh_` is that node's secret. There is one per trigger, and if you delete the node the token goes with it. Treat it like a password: do not paste it in a public repository or a ticket.

A practical consequence: while the flow is switched off, the URL answers 404. That is the same answer a nonexistent token gets, so anyone probing it cannot tell a paused flow from an invented URL.

## 2. Choose which methods it accepts

The **Accepts** field has three options: POST only (the default), GET only, or GET and POST. Any other method gets a 405.

- **POST** for almost everything: forms, Stripe, GitHub, your own backend.
- **GET** for services that verify the URL before they start sending events, or for a button in an email that triggers an action.
- **GET and POST** when you have both cases on the same URL.

The body is parsed according to the `Content-Type`. With `application/json` it becomes an object (and if the JSON is broken, the caller gets a 400 instead of a run full of garbage). With `application/x-www-form-urlencoded` it becomes an object of fields. Any other type arrives as text. The cap is 256 KB: anything larger gets a 413.

## 3. Read the data in the following steps

Everything that arrives is available as a template in later nodes:

- `{{trigger.body}}` for the body, and for example `{{trigger.body.email}}` for one field.
- `{{trigger.query}}` for URL parameters (`?source=landing`).
- `{{trigger.headers}}` for the headers.
- `{{trigger.method}}` to know whether it was GET or POST.

A concrete example: a form on your site sends a POST with `{"name": "Ana", "email": "ana@example.com"}`. Add a **CRM: create contact** node with the email `{{trigger.body.email}}`. If a contact with that email already exists, the node returns the existing one instead of duplicating it, so resubmitting the form does not pollute your data. Then add **CRM: enroll in sequence** to start the follow-up.

To see how each value turned out, open the run: the history stores the input and output of every step.

## 4. Lock the door with a credential

By default, anyone who has the URL can call it. If the calling service can send a header, ask for authentication in the **Require authentication** field. There are two ways:

- **API key in a header.** You create a credential with the header name (for example `X-Api-Key`) and the value. Every request must carry it, otherwise it gets a 401.
- **Username and password (Basic).** For services that only know how to send `Authorization: Basic`.

The secret is compared in constant time, and the header holding the key is not passed to the flow, so it is not stored in the run history. If you delete the credential, the URL does not open up: it stays closed until you pick another one. Failed attempts also count against the IP limit, which slows down anyone guessing passwords.

Today Flow does not validate generic HMAC signatures on this trigger. Stripe has its own trigger that verifies the signature with the signing secret. If you need to verify another signature, your options are a code node that computes it, or an API key in the header.

## 5. Reply with your own status code

By default the webhook answers 202 right away and the run continues in the background. That fits most cases: the outside service does not sit waiting.

When the reply has to depend on the result, change **Responds** to **With the Respond to webhook step** and add that node at the end. You choose the status code, the content type (JSON, text or HTML) and the body, which can use data from earlier steps. A simple case:

1. Incoming webhook receives `{"email": "ana@example.com"}`.
2. A **CRM: create contact** node creates or finds the contact.
3. **Respond to webhook** returns 200 with a confirmation JSON. If you put a **Filter** node before it that cuts the branch when `{{trigger.body.email}}` does not exist, you can place another **Respond to webhook** on the error branch with a 422.

The real limits: the caller waits up to 25 seconds. If the run has not replied in time, the caller gets a 202 and the run carries on. If the flow fails, the caller gets a 500. The reply is delivered with `Content-Security-Policy: sandbox`, so an HTML body built from outside data cannot run scripts on your domain.

That covers endpoint verification, forms that need a clear status code, and small APIs. It does not cover anything that takes a minute: for that, answer 202 and notify through another channel when it finishes.

## Limits worth knowing

- Each token accepts 600 requests per minute. Beyond that it gets a 429.
- Each workspace has a cap of runs per hour: 1000 by default, configurable in self-host with the `FLOW_RUNS_PER_HOUR` variable. Past the cap, the webhook answers 429 and the caller can retry later.
- The `cookie` and `authorization` headers and infrastructure ones (`x-forwarded-*` and similar) are dropped before the flow sees them.
- There is only one URL per trigger: no separate test URL exists. To test without touching production, build a second flow with its own trigger and point the test service at that URL.

## Checklist before you publish the URL

1. Pick the narrowest method you need.
2. If the service allows it, require an API key in a header.
3. Test with `curl` and check the run in the history.
4. Set up an error flow so you hear about failures (we cover it in [When a flow fails](/blog/cuando-un-flow-falla)).
5. Store the URL in a secrets manager, not in the team chat.

With self-host, all of this runs on your server and the runs are stored in your own database.
