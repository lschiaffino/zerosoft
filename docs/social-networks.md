# Social: developer apps and environment variables

Social (`/app/social`) publishes through each network's official API. Every
network except Bluesky needs a **developer app created by whoever runs the
instance**. Without its variables, the network shows as "Not configured by the
instance admin" in Social › Accounts and Social › Settings.

Two URLs are the same for every app (replace the host with your
`NEXTAUTH_URL`):

| What | URL |
|---|---|
| OAuth redirect (callback) | `https://<your-host>/api/social/oauth/callback` |
| Meta webhook | `https://<your-host>/api/social/webhooks/meta` |

Register the redirect URL **exactly** (scheme, host, path, no trailing slash).
Tokens are stored encrypted with `ENCRYPTION_KEY` (or `NEXTAUTH_SECRET`):
rotating it means reconnecting every account.

## Meta: Facebook pages and Instagram business accounts

One app covers both networks.

1. Create an app at <https://developers.facebook.com/apps> (type **Business**)
   and add the **Facebook Login for Business**, **Instagram** (API setup with
   Facebook Login) and **Webhooks** products.
2. Facebook Login › Settings › Valid OAuth Redirect URIs: the redirect URL above.
3. Permissions to request in **App Review** (Advanced Access) before anyone
   outside your app roles can connect:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `pages_manage_engagement`, `pages_read_user_content`, `pages_manage_metadata`,
   `pages_messaging`, `read_insights`, `business_management`,
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`,
   `instagram_manage_insights`, `instagram_manage_messages`.
   Meta also requires **Business Verification** for most of them.
4. Webhooks: subscribe the **Page** object (fields `feed`, `messages`) and the
   **Instagram** object (fields `comments`, `mentions`, `messages`) to the
   webhook URL above, with the verify token below.
5. Instagram accounts must be **business or creator** accounts linked to a
   Facebook page. Instagram only accepts JPEG photos through the API.

```
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=   # any random string; the same one in the Webhooks product
```

The webhook is one per instance. If the same page or Instagram account is
connected in two workspaces, each workspace gets its own copy of every comment
and message in its inbox. An event is marked as seen only after it is stored;
if storing fails, the webhook answers 500 and Meta retries it.

Every Graph call sends `appsecret_proof`, so you can turn on "Require App
Secret" in the app's advanced settings.

## LinkedIn: profiles and company pages

1. Create an app at <https://www.linkedin.com/developers/apps>, linked to a
   company page you administer.
2. Auth › Authorized redirect URLs: the redirect URL above.
3. Products: **Sign In with LinkedIn using OpenID Connect** and **Share on
   LinkedIn** (personal profiles, approved instantly).
4. For company pages (`r_organization_social`, `w_organization_social`,
   `rw_organization_admin`), request the **Community Management API**
   (formerly Marketing Developer Platform). LinkedIn reviews it; until then,
   only personal profiles connect. Refresh tokens are only issued to approved
   apps: without them, people reconnect every 60 days (Social warns when an
   account expires).

```
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
```

## X

1. Create a project and app at <https://developer.x.com/en/portal/dashboard>.
2. User authentication settings: **OAuth 2.0**, type **Web App (confidential
   client)**, permissions **Read and write**, callback URL = the redirect URL
   above, website URL = your site.
3. Scopes used: `tweet.read tweet.write users.read media.write offline.access`
   (PKCE is always on).
4. Plan: the Free tier only allows a small number of posts per month. Reading
   mentions for the inbox needs a paid tier (Basic or higher). Video upload is
   not supported yet; photos are.

```
X_CLIENT_ID=
X_CLIENT_SECRET=
```

## TikTok

1. Create an app at <https://developers.tiktok.com/apps> and add **Login Kit**
   and **Content Posting API** (Direct Post).
2. Redirect URI: the redirect URL above. Verify the domain if TikTok asks.
3. Scopes: `user.info.basic`, `user.info.profile`, `user.info.stats`,
   `video.publish`, `video.upload`, `video.list`.
4. Until TikTok **audits** the app, every post is published as private
   (`SELF_ONLY`); Social uses whatever privacy levels TikTok allows. The public
   API has no comments, so TikTok has no inbox.

```
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

## YouTube

1. In Google Cloud (<https://console.cloud.google.com>), enable the **YouTube
   Data API v3** and create an **OAuth client ID** of type Web application.
2. Authorized redirect URIs: the redirect URL above.
3. OAuth consent screen scopes: `youtube.upload`, `youtube.force-ssl`,
   `youtube.readonly`. These are sensitive scopes: Google verification is
   needed before people outside your test users can connect, and unverified
   projects upload videos as private.
4. Uploads use the default API quota (10,000 units a day; one upload costs 1,600).

```
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

## Threads

1. In your Meta app (or a new one), add the **Threads API** use case.
2. Redirect callback URL: the redirect URL above.
3. Permissions: `threads_basic`, `threads_content_publish`,
   `threads_manage_replies`, `threads_read_replies`, `threads_manage_insights`
   (App Review for people outside the app's testers).

```
THREADS_APP_ID=
THREADS_APP_SECRET=
```

## Bluesky

Nothing to set up. Each workspace connects with its handle and an **app
password** (Bluesky › Settings › Privacy and security › App passwords). The
password is not stored: only the session tokens, encrypted. Only accounts
hosted by Bluesky (`bsky.social`) are supported.

## Limits that apply to every network

- Files go through the suite upload: 10 MB per photo or video. With
  `BLOB_READ_WRITE_TOKEN` they live in Vercel Blob; otherwise in
  `UPLOADS_DIR`. Meta and Threads download the file from its URL, so the
  instance must be reachable from the internet.
- The minute cron (`/api/cron/minute`) publishes due posts, retries with
  backoff (1, 5, 15 and 60 minutes, five attempts), refreshes tokens that are
  about to expire, polls each inbox every 5 minutes and pulls metrics every hour.
- Outbound calls only go to the networks' fixed API hosts, through `safeFetch`.

## Testing without real networks

`SOCIAL_FAKE=1` (only with `NODE_ENV=test` or `DEMO_MODE=true`) makes every
network "configured" and simulated: OAuth comes back at once, a text with
`[fail]` is rejected, one with `[flaky]` fails once and then publishes, each
published post gets a comment and metrics. The e2e suite uses it.
