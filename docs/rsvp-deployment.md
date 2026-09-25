# RSVP deployment and operations

## Architecture and security model

The public HTML, CSS, and JavaScript remain on GitHub Pages. The `www.daniel-and-colleen.com` DNS record must be Cloudflare-proxied. A narrowly scoped Worker route intercepts only `www.daniel-and-colleen.com/api/rsvp/*`; unmatched paths continue to the configured GitHub Pages origin. The browser therefore calls a same-origin API without CORS.

`POST /api/rsvp/suggest` accepts a name fragment (at least two meaningful characters) and returns at most eight names plus `hasMore`. Search deliberately makes guest names discoverable. It uses case/accent/punctuation-tolerant token prefixes, not fuzzy matching or nickname inference. Suggestions contain no party identifiers, response status, or private response values. There is no pagination or public roster endpoint.

`POST /api/rsvp/lookup` receives the explicitly selected full name and a Turnstile token. It retains authoritative imported-name normalization and rejects ambiguous identities. An unanswered invitation returns only `state: "unanswered"`, an opaque `party.publicId`, and guest IDs/names. An answered invitation returns only `{ "state": "already_submitted" }`. Saved attendance, meals, dietary information, email, address, and messages are never returned by public endpoints.

`POST /api/rsvp/submit` requires a fresh Turnstile token, validates complete party membership and required fields, and creates the response exactly once. Its first statement inserts the uniquely constrained party response; subsequent statements insert guest responses in the same atomic D1 batch. A failed batch rolls back completely. A competing or later submission returns HTTP 409 with `code` and `state` equal to `already_submitted`. No public update endpoint exists. Changes require contacting Daniel or Colleen through their existing private communication channels; this feature adds no couple-facing admin tool.

Suggestions do **not** require Turnstile. Suggestions and lookup share the existing 10 requests/minute/IP limiter; submission retains 5 requests/minute/IP. All endpoints check the honeypot and return `Cache-Control: no-store`. Errors use stable `code` values; validation errors include a `fields` map keyed by input ID. HTTP 429 includes `Retry-After: 60`. Logs contain only a generic error class; never add request-body logging. Name-based access does not prove guest identity: anyone who finds an unanswered invitation can submit it. This tradeoff is explicitly accepted; previously saved responses remain inaccessible.

## Current development boundary

The live `/api/rsvp/*` route intentionally still points to the **preview Worker**. Leave that assignment unchanged. Production D1 is already migrated and populated; this redesign requires no migration, import, secret, route, or `wrangler.jsonc` change. The historical provisioning/production sections below are reference only, not steps to repeat for this redesign.

## Local frontend with the preview Worker

Requirements: Node.js 22+ (Node 24 recommended), `npm ci`, and the existing preview Worker's `workers.dev` hostname. Copy that hostname from the preview Worker's dashboard; the account-specific subdomain is not in this repository. Do not substitute the live wedding domain, which is intentionally rejected even while it routes to preview.

From the repository root, in PowerShell:

```powershell
$env:RSVP_PREVIEW_ORIGIN = 'https://daniel-colleen-rsvp-preview.YOUR-ACCOUNT-SUBDOMAIN.workers.dev'
npm run preview
```

Open **http://localhost:4173/rsvp.html**. Replace `YOUR-ACCOUNT-SUBDOMAIN` with the existing preview account subdomain before running. This environment variable is a public URL, not a secret. No credentials are needed by the proxy. `PORT` can select another local port; the default is 4173. Stop the server with Ctrl+C.

The development-only Node server binds to loopback and serves only an explicit allowlist of public HTML, CSS, JavaScript, and existing public images. It never serves directories, dotfiles, private CSVs, Worker/configuration files, or databases. It proxies only POST requests to `/api/rsvp/suggest`, `/api/rsvp/lookup`, and `/api/rsvp/submit`. Only an HTTPS `daniel-colleen-rsvp-preview.<account>.workers.dev` origin is accepted, and redirects are blocked. It does not forward cookies, authorization, or caller-supplied forwarding headers, log request contents, or read Wrangler configuration. Verify in Cloudflare that the named preview Worker retains its preview DB binding before manual testing; a local proxy cannot inspect an upstream Worker's bindings.

**Turnstile prerequisite:** protected lookup/submission must use a widget whose allowed hostnames include `localhost`, and its site key must correspond to the secret already used by the preview Worker. The committed public site key is unchanged. If that widget does not already allow localhost, autocomplete can work but protected actions will fail. Do not bypass verification or change production/shared widget settings as part of this workflow. A separately approved preview-only widget setup is needed if the existing setup is incompatible. Dummy site keys do not work against a Worker using a real secret. See [Cloudflare's testing guidance](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) and [token validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

Proxy requests share your computer's public IP for rate limiting. A human-paced search usually reuses complete cached results as the query narrows; rapid unrelated searches can exhaust the unchanged shared limiter. A 429 pauses network retries and asks the user to wait. Real preview submissions are final for guests: use only explicitly designated **synthetic** preview invitations. Never use or reset real invitations for testing.

The redesigned frontend needs the redesigned preview Worker API. Before manual end-to-end testing, deploy the Worker only when separately authorized:

```sh
npx wrangler deploy --env preview
```

This command deploys the preview Worker only; it does not publish the local frontend or apply migrations. Because the live API route currently targets preview, deploying preview changes API behavior for the live frontend too. The old frontend expects saved-response reload/update semantics and is not compatible with the new terminal-state contract. Coordinate that transition before running the command; do not switch the route or deploy the static site automatically.

## Local automated checks and manual acceptance

```sh
npm test
npm run check
npm run test:browser
git diff --check
git status --short --branch
```

`npm test` uses synthetic in-memory repository fixtures and an ephemeral local Miniflare D1 binding created from the checked-in schema. It does not load Wrangler configuration, authenticate, import a CSV, or access remote D1. The importer tests stub their subprocesses; their printed "Importing into preview" message does not represent a remote import. D1 tests exercise actual local batch rollback, simultaneous first submissions, and duplicate identities. Miniflare is pinned to the API/runtime version already used by the installed Wrangler.

`npm run test:browser` uses installed Google Chrome by default. For installed Microsoft Edge in PowerShell, set `$env:RSVP_TEST_BROWSER = 'msedge'` first. Browser tests start their own static-only local server, mock every RSVP response and Turnstile callback, and block all external page requests. No remote Worker or D1 can be reached by this harness. Free port 4173 before running it. Screenshots and failure artifacts go under ignored `node_modules/.cache/`. Real Turnstile challenges still require manual preview verification.

Manual matrix, using synthetic preview invitations only:

| Area | Verify |
| --- | --- |
| Discovery | Exact names, case/accents, surrounding/repeated spaces, apostrophes, hyphens/spaces, first/surname prefixes, multi-token prefixes; two-letter results narrow as typing continues |
| Recovery | Unknown names, typos, nicknames, duplicate full names, `hasMore`, network failure, rate limit and retry; no automatic selection |
| Invitation | Single guest, multiple guests, long family; confirm names; Search again clears previous invitation |
| Attendance | All Yes, all No, mixed; every guest required; Yes needs dinner; No hides and omits dinner/dietary; toggling back restores draft |
| Contact/review | Required email/address, optional unit/message, browser autofill, inline errors, linked summary, edit each review section before submission |
| Submission | Double click, two tabs competing, offline/retry, terminal success; reopened/repeated response gives only already-submitted guidance; no saved details exposed |
| Turnstile | Automatic completion, visible interaction, expiry, blocked script, timeout, lookup/submission failure; pending action resumes once; no token reuse |
| Accessibility | Keyboard-only arrows/Enter/Escape/Tab, native radios, step/error focus clear of sticky header, screen-reader announcements, 200% zoom, reduced motion |
| Devices | 320/375/390/768 px widths and desktop; Safari/iPhone, Chrome/Android, Chrome/Edge/Firefox desktop; no horizontal overflow |

Do not reset a submitted preview party through the public API; use another designated synthetic invitation. No public guest-side edit or saved-RSVP reload is expected.

## One-time prerequisites

1. Install Node.js 22+ and run `npm ci`.
2. Authenticate the Wrangler CLI locally with `npx wrangler login` (or set a narrowly scoped `CLOUDFLARE_API_TOKEN` in your shell/CI secret store).
3. In the Turnstile dashboard, allow `www.daniel-and-colleen.com` plus the preview hostname you will test. The public site key is intentionally in `rsvp.html`; the secret must never be placed in a file committed to Git.
4. Confirm the D1 resources in `wrangler.jsonc` are owned by the authenticated account.

No command in this document is run automatically. In particular, production deployment is an explicit manual action.

## Apply D1 migrations

Preview first:

```sh
npx wrangler d1 migrations apply DB --env preview --remote
```

After preview verification, production:

```sh
npx wrangler d1 migrations apply DB --env production --remote
```

The migration enables foreign keys, relationship cascades, uniqueness constraints, attendance/dinner checks, and the normalized-name lookup index. Keep every future schema change as a numbered file in `migrations/`.

## Import the private guest CSV

Create the file as `private/guests.private.csv` (both the directory and suffix are ignored by Git) with this exact header:

```csv
party_number,party_name,guest_name
```

Do not stage, paste, or commit the real file. The importer supports quoted RFC-style fields, validates the header/column count, positive party numbers, consistent party names, blank names, and normalized-name duplicates. It preserves row order within each party and generates a cryptographically random public ID. Production is refused unless the input contains exactly **33 parties and 63 guests**.

Import only into an empty migrated database; uniqueness constraints intentionally make an accidental second import fail:

```sh
npm run import -- private/guests.private.csv --env preview
npm run import -- private/guests.private.csv --env production
```

The temporary SQL is created outside the repository with owner-only permissions and removed afterward, including when Wrangler fails. The importer invokes the project-local Wrangler installation through Node (rather than a platform shell), so file paths and the verification SQL remain intact arguments on Windows, macOS, and Linux. The importer queries D1 after the import and fails unless the resulting counts exactly equal the parsed CSV counts (and, for production, 33/63). D1 remote execution controls transaction rollback, so the generated file intentionally does not contain explicit transaction statements.

## Configure the Turnstile secret

Set the same Worker secret independently in each environment. Wrangler prompts for the value and does not write it to the repository:

```sh
npx wrangler secret put TURNSTILE_SECRET_KEY --env preview
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
```

Use the secret corresponding to the committed Turnstile site key. Never use `wrangler.jsonc`, `.dev.vars`, source code, issue comments, or CI logs to store it. For local-only development, `.dev.vars*` is ignored, but a Cloudflare test key is safer.

## Preview deployment and testing

Run all local checks before any deployment:

```sh
npm test
npm run check
npx wrangler deploy --dry-run --env preview
```

Deploy the preview Worker explicitly:

```sh
npx wrangler deploy --env preview
```

The preview environment enables a `workers.dev` URL. Use the local development proxy above for same-origin frontend testing. Do not add or change Cloudflare routes for this redesign.

## Production route and deployment

The production route is version-controlled as:

```text
www.daniel-and-colleen.com/api/rsvp/*
```

Before deploying, in **Cloudflare Dashboard → DNS**, ensure `www` is proxied (orange cloud) and still targets the GitHub Pages custom-domain origin. In **Workers & Pages → Routes**, confirm the `daniel-and-colleen.com` zone is available. The route causes only matching API requests to execute the Worker; it does not migrate or replace GitHub Pages.

After migrations, import, secret setup, preview acceptance, and a D1 backup, deploy manually:

```sh
npx wrangler deploy --env production
```

Then verify normal pages still load, solve Turnstile, look up a controlled invitation, submit it, look it up again, and verify the saved values. If route creation is managed outside Wrangler instead, remove `routes` from the production environment before deployment and create the exact route above in **Workers & Pages → the Worker → Settings → Domains & Routes → Add route**.

## Export RSVP data safely

Export to an ignored private path on an encrypted/trusted workstation:

```sh
mkdir -p private
npx wrangler d1 export DB --env production --remote --output private/rsvp-backup.private.sql
chmod 600 private/rsvp-backup.private.sql
```

For a reviewable RSVP report, use the dashboard D1 console or `wrangler d1 execute` with a targeted `SELECT` joining `parties`, `guests`, `party_rsvps`, and `guest_rsvps`. Redirect output only into `private/`; never publish it, attach it to GitHub, or paste it into public logs.

## Backup and recovery

Before migrations, imports, or bulk changes, take the SQL export shown above and retain an encrypted, access-controlled copy. Cloudflare D1 Time Travel can restore a database to a timestamp/bookmark within the account's available retention window; consult the current D1 dashboard/documentation for the account's retention.

For recovery to a fresh D1 database: create the replacement, apply repository migrations, import the trusted SQL backup with `wrangler d1 execute --remote --file`, verify party/guest/RSVP counts and spot-check relationships, update the `database_id` only in the intended Wrangler environment, deploy, and run the end-to-end checks. Do not overwrite the working database until the restored copy is verified.

## Private inspection

Use **Cloudflare Dashboard → D1 → the selected database → Console** (protected by Cloudflare account access) or authenticated Wrangler commands. Example non-sensitive counts:

```sh
npx wrangler d1 execute DB --env production --remote --command \
  "SELECT (SELECT COUNT(*) FROM parties) parties, (SELECT COUNT(*) FROM guests) guests, (SELECT COUNT(*) FROM party_rsvps) responses;"
```

Grant account access only to people who need RSVP data, enable MFA, and avoid selecting names/contact/address/dietary/message columns unless required. There is no public roster or export endpoint; these operations are restricted to authenticated admins.

## Admin roster access

Set `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and a long, random `ADMIN_SESSION_SECRET`
as encrypted Worker secrets in both environments before deployment. The built-in
username and password are only the requested initial credentials and should be
overridden when credentials rotate. Admin sessions use signed, HTTP-only, secure,
same-site cookies with an eight-hour lifetime. The admin Excel-compatible CSV is
generated directly from the current D1 data on each download, with no separate
copy or synchronization process.
