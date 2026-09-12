# RSVP deployment and operations

## Architecture and security model

The public HTML, CSS, and JavaScript remain on GitHub Pages. The `www.daniel-and-colleen.com` DNS record must be Cloudflare-proxied. A narrowly scoped Worker route intercepts only `www.daniel-and-colleen.com/api/rsvp/*`; unmatched paths continue to the configured GitHub Pages origin. The browser therefore calls a same-origin API without CORS.

`POST /api/rsvp/lookup` normalizes a supplied full name in the Worker, queries D1, and returns only one matching party. No match and an ambiguous normalized name receive the same error. `POST /api/rsvp/submit` reloads the party and guest membership from D1, validates the complete response, and atomically batches upserts. The browser never receives party numbers, normalized names, database IDs, lists of other parties, or RSVP data from another invitation.

Both endpoints require Turnstile and are limited per Cloudflare client IP: 10 lookups/minute and 5 submissions/minute. The honeypot is also checked in the Worker. Logs contain only a generic error class; do not add request-body logging. D1 itself is not publicly bound.

## One-time prerequisites

1. Install Node.js 20+ and run `npm ci`.
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

The temporary SQL is created outside the repository with owner-only permissions and removed afterward. The importer queries D1 after the import and fails unless the resulting counts exactly equal the parsed CSV counts (and, for production, 33/63).

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

The preview environment enables a `workers.dev` URL. Test lookup and submission through the actual page only from a Turnstile-allowed hostname and a same-origin route; the production frontend deliberately does not contain a cross-origin preview endpoint. A temporary preview custom-domain route may be added in the Cloudflare dashboard for end-to-end testing, then removed. Do not broaden the production route.

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

Grant account access only to people who need RSVP data, enable MFA, and avoid selecting names/contact/address/dietary/message columns unless required. There is intentionally no public admin or export endpoint.
