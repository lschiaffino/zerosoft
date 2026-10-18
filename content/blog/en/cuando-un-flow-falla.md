---
title: "When a flow fails: retries, error branches and re-runs"
description: "Which errors are worth retrying, when to continue and when to stop, how to build an error flow that alerts you, and how to re-run from the failed step without repeating the ones before it."
date: "2026-10-18"
author: "zerosoft"
tags: ["flow", "automation", "errors"]
---

An automation that has never failed is one that hasn't run long enough. The external API goes down for ten minutes, someone deletes the Track project a flow was using, a form arrives without an email. The useful question is what happens next: whether you find out, whether it fixes itself, and whether you can finish the job without repeating what already worked.

n8n solved part of this with its [error workflow](https://docs.n8n.io/flow-logic/error-handling/): a separate workflow, starting with an Error Trigger node, that runs when another one fails. It's a good idea and Flow has an equivalent. But the error flow is the last line of defense. Before it come three per-node decisions that prevent most alerts.

## First, split errors into two kinds

**Transient.** The service didn't answer in time, the network failed, the API returned a 500 or a 429 (asking you to slow down). Try again in a while and it will probably work.

**Permanent.** A field is missing, the credential expired, the email isn't valid, the API returned a 400 or a 404. Retrying ten times gets you the same error ten times.

Flow makes this split for you. A retry only fires on timeouts, network errors, 5xx responses, 429s and AI rate limits. A 404 is not retried even if you set five attempts, because there's no point.

## Decision 1: how many retries

Every node that talks to the outside world has "Retries on failure" under Advanced, from 0 to 5. The wait doubles on each attempt: 15 seconds, 30, 60, and so on, up to a cap of one hour between attempts.

A practical guide:

- **HTTP request to an API you don't control:** 2 or 3.
- **Slack, Sheets, Notion, Discord, Telegram:** they default to 1. That's enough.
- **Anything that isn't idempotent** (more below): 0, unless you know the service deduplicates.

An honest caveat: on zerosoft Cloud the scheduler runs once an hour, so each retry resumes on the next pass, not 15 seconds later. Self-hosted, it follows your cron. Inside a Loop it works differently: nothing gets scheduled, the retry happens right away, up to 3 times with short waits and a total budget of 30 seconds.

## Decision 2: what the node does if it still fails

After the retries, every node has an "If this step fails" option with three modes:

**Stop the flow.** The default. The run fails at that node. Use it when the next steps depend on this one: if the contact wasn't created, there's no point enrolling it in a sequence.

**Continue.** The step is marked as failed and the flow keeps going through the normal output. The node's output carries `error` and `failed: true`, so a later step can read it. Good for the nice-to-haves: if the Discord alert fails, the Track issue should still get created.

**Use the error branch.** The node gets an Error output and you connect whatever should happen there. The message is in `{{nodes.<id>.output.error}}`. This is the mode for a plan B: if the main API fails, send the data to a spreadsheet to enter by hand later.

An example with all three:

```
Webhook → CRM: create contact        (Stop: without a contact there's nothing to do)
        → HTTP request to billing    (Error branch → Google Sheets row "pending")
        → Slack #sales               (Continue: the alert is the least of it)
```

## Decision 3: an error flow for everything else

Whatever stays unhandled ends up as a failed run. To find out without opening the history every day, set up an error flow. In the editor, pick another flow from your workspace under "Error flow". When a run fails, that flow runs with this data:

- `{{trigger.flow.name}}`: which flow failed.
- `{{trigger.run.error}}`: the error, prefixed with the node id.
- `{{trigger.failedNode.id}}` and `{{trigger.failedNode.type}}`: where.
- `{{trigger.trigger}}`: whatever triggered the original run.

A minimal error flow has a single Slack node:

```
"{{trigger.flow.name}}" failed: {{trigger.run.error}}
Node: {{trigger.failedNode.id}} ({{trigger.failedNode.type}})
```

One error flow can serve all your flows. Credentials used in the run arrive masked, so they don't end up in a Slack channel. And an error flow that fails doesn't trigger another error flow, so there are no infinite chains.

## Re-run from the step that failed

You got the alert, found the problem (the Track project the node used no longer exists) and fixed it in the editor. Now you need to finish the run that stopped halfway.

In the run history, open the failed run and click **Re-run from here** on the node that failed. Flow creates a new run that:

- reuses the output of every earlier step, without executing them again;
- runs that node and everything after it with the saved version of the flow, including your fix.

So the contact isn't created twice and the welcome email doesn't go out again. It works on failed and successful runs. Two limits: you can't re-run from the trigger, and steps inside a Loop re-run from the whole Loop.

If the fix turned out worse than the problem, the Versions tab saves a version every time the nodes change (up to 50) and shows which nodes were added, removed or edited. Restoring a version saves the current one first, just in case.

## Idempotency: the question before every retry

Retrying is only safe if doing the same thing twice gives the same result. Here's how Flow's nodes behave:

- **CRM: create contact** looks up the email first. If the contact exists, it returns it and doesn't create another.
- **Stripe** sends an idempotency key per run and per node, so a retry of the same run won't create two customers.
- **HTTP request** depends on the API on the other side. A `POST` that creates an invoice, retried after a timeout, can create two. If the API accepts an idempotency header, send it with `{{run.id}}`. If it doesn't, leave retries at 0 and use the error branch.
- **Send email** has no way of knowing whether it already sent. A retry is another email.

## Limits worth knowing

So one error doesn't turn into a bigger one, every run has caps: 200 steps (up to 1,000 with Loops, which reserve what they need before starting), 100 items per Loop and 1,000 runs per hour per workspace. A Loop that doesn't fit the cap fails before processing its first item, instead of stopping halfway with partial side effects.

## A ten-minute weekly routine

1. Open the flow list, check each flow's last run status and open the history of the ones that failed.
2. For each permanent error, fix the node and re-run from there.
3. For each transient error that keeps coming back, raise the retries or switch that node to an error branch.
4. If the error flow alerted you more than three times about the same thing, that alert is a pending fix.

If you're still deciding what to automate, start with [five flows for a small team](/blog/que-automatizar-primero).
