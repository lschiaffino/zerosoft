---
title: "Human approvals in a flow: pause, ask and continue"
description: "How to put a person in the middle of an automation: Flow's Approval node, what happens when nobody answers, how to use the comment, and a full example with discounts."
date: "2026-10-30"
author: "zerosoft"
tags: ["flow", "automation", "approvals"]
---

Some decisions should not be automated. A large refund, a discount outside the price list, an expense over the monthly cap. What you can automate is everything around the decision: gathering the data, asking the right person, waiting for the answer and doing the right thing when it arrives.

That is called "human in the loop". Zapier wrote a [whole guide](https://zapier.com/blog/human-in-the-loop-guide/) and built a dedicated step for it, and n8n has a [Send and Wait for Response](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.respondtochat/) operation. Flow solves it with one node, Approval. This guide explains how it really behaves, including the awkward cases: nobody answers, two people answer at once, someone opens the link by accident.

## What the node does

Approval pauses the run and sends a request by email to up to 10 people. If you pick a Slack credential, it also posts to a channel with two buttons. Each recipient gets signed links that open a page where they can approve or reject and leave an optional comment.

The node has two outputs, **Approved** and **Rejected**. You connect what should happen to each one, with no condition node in between.

Fields you will fill in:

- **Who approves:** comma-separated emails. Variables work, so `{{trigger.manager_email}}` is fine.
- **Subject and What needs approval:** variables work here too. Put all the context needed to decide without opening another tab.
- **Also ask in Slack:** optional, with a credential and a channel.
- **Time limit and If nobody answers**, under Advanced.

## The first answer counts

If you send the request to three people, whoever answers first decides. The other two see that the request was already answered when they open their link. They do not need to coordinate, and there is no "everyone must approve" mode. If your rule is "two signatures", chain two Approval nodes, each with its own group.

This keeps the design simple: the request goes to a group that is allowed to decide (say, the three people in sales who can give discounts) and it is settled when someone takes it.

## An opened link is not a decision

Approval links carry `?decision=approve` or `?decision=reject`. You might expect that opening one already decides, but it does not: the page shows the chosen option and waits for you to confirm with a button. The reason is practical. Many mail and security services open the links in emails to scan them, and if a GET approved, a scanner would approve refunds on your behalf.

The same goes for Slack: the buttons open the page, they do not decide by themselves.

## What happens if nobody answers

Every request is born with an expiry. The default is 3 days, and you can set it in hours or days. When it expires, the node does what you set in **If nobody answers**:

- **Reject** (the default): the run continues through Rejected. This is the prudent choice for money.
- **Approve:** continues through Approved. It suits low-risk requests where silence means "go ahead", like asking for access to a test tool.
- **Fail:** the run ends with the error `approval_timeout`, and everything you already know from [when a flow fails](/blog/cuando-un-flow-falla) applies: error flow, alert, re-run from the node.

The expiry is resolved by Flow's worker, so it can land a little after the exact time, depending on how often your cron runs. Keep that in mind for deadlines measured in hours. The email tells the recipient the expiry date.

## What data the decision leaves

After the node, the following steps can read:

- `{{nodes.<id>.output.approved}}`: true or false.
- `{{nodes.<id>.output.decision}}`: `approved` or `rejected`.
- `{{nodes.<id>.output.comment}}`: what the person wrote (empty if they wrote nothing or it expired).
- `{{nodes.<id>.output.decidedAt}}`: when it was decided.
- `{{nodes.<id>.output.timedOut}}`: true if the expiry decided and not a person.

The comment is the most useful part. A rejection with no reason produces three rounds of messages. A rejection with a reason can be forwarded as is to whoever asked.

## Example: discounts above 20%

The case: someone in sales needs to offer a bigger discount than allowed, and the head of sales has to authorize it before the quote goes out.

```
Webhook (discount requested: deal, amount, percent, reason, seller email)
  → Filter: percent > 20
  → Approval
      Who approves:    sales-lead@yourcompany.com
      Subject:         {{trigger.percent}}% discount for {{trigger.deal}}
      What to approve: Requested by: {{trigger.seller_email}}
                       List amount: {{trigger.amount}}
                       Reason: {{trigger.reason}}
      Time limit:      1 day. If nobody answers: reject.
  → [Approved]   Send email to the seller: "Approved. {{nodes.approval.output.comment}}"
  → [Rejected]   Send email to the seller: "Not approved. Reason: {{nodes.approval.output.comment}}"
```

If your deals live in zerosoft CRM, the trigger can be a CRM event such as `deal.updated` instead of a webhook. The rest of the flow stays the same.

## Limits worth knowing

- **It cannot be used inside a Loop.** One request per item in a list of a hundred would be a hundred emails, and the editor will not let you build it. If you need to approve a batch, gather a summary into a single request before the Loop.
- **Up to 10 recipients** per node.
- **The run stays in a waiting state** and, once resumed, continues from that node with the context it had.
- **The request goes by email or Slack.** The approver opens a public signed page and needs no zerosoft account. According to [Zapier's documentation](https://help.zapier.com/hc/en-us/articles/38733184458765/), the reviewer signs in to their Zapier account to decide. For approvals from an outsider (a client, an accountant), the first approach fits better.
- **It does not edit data.** The person decides and comments but does not change the request fields. If you need them to correct an amount, use "Wait until a call" and a form of your own that resumes the run.

## When not to add an approval

Every approval adds waiting and asks for a person's attention. A rule to decide:

1. If the mistake is easy to fix afterward (a wrong tag), do not ask permission: act and notify.
2. If the mistake costs money or trust (a refund, an email to every customer), ask for approval.
3. If the same person approves 100% of requests for a month, the control is filtering nothing. Turn it into an automatic rule.

## How to test it before leaving it running

Send the request to yourself with a 15-minute expiry and walk the three paths: approve with a comment, reject, and let it expire. Pin test data on the trigger to repeat it without reloading anything. Then check the run history and confirm the step shows as waiting and later as successful, with the output you expected.

If you are just starting with Flow, [what to automate first](/blog/que-automatizar-primero) gives you five flows to begin with, and every one of them can take an approval at the point where the risk calls for it.
