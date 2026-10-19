# Local-first deployment: architecture and rollout

## Target topology

The LAN deployment is the only write authority. Users on the office network
connect to the LAN-hosted ERP and its LAN-hosted Supabase services, so sales,
stock, accounting, and identity continue to work when the internet is down.
The hosted cloud is a one-way backup/read replica; it must not accept
independent business writes.

Offline authorization is limited to 30 days from the last successful online
authorization. Revocations and password/role changes cannot reach an isolated
server, so the local instance must enforce this expiry instead of silently
extending cached access.

## Current implementation boundary

The existing `Dockerfile` and `docker-compose.yml` containerize the web
application only. Supabase URL and public key are supplied when the frontend
image is built, while server-only Supabase credentials are runtime settings.
The local Supabase development stack is started separately with the Supabase
CLI; Docker Compose does not provision or link it automatically. Pointing the
app settings at the hosted project still requires internet access; it is not
offline mode.

For local schema development, `supabase start` launches the Supabase CLI's
local development stack. After confirming it is a fresh, disposable database,
run `.\scripts\local\apply-drizzle-migrations.ps1` from PowerShell to apply the
ordered ERP SQL files and record their names in a local-only migration ledger.
The script refuses a database that already has ERP tables or a prior attempt;
it never drops or resets data. If a migration fails, inspect the error and
recreate the disposable local stack yourself before retrying. This CLI stack is
a development/bootstrap tool, not yet a hardened or supported LAN production
deployment.

The production build now generates its service worker from the final client
output, precaches the app's route chunks, and keeps a public app-shell fallback
for direct route refreshes while offline. The browser cache can restore
previously loaded query data, and its plain-table write queue can replay
selected writes after reconnecting. None of these features provisions a local
database or provides standalone offline authentication. Server RPC operations
still require the configured backend. Do not treat an HTTP-accepted queued
write as a committed financial or stock transaction.

When building the application for a local stack, set `VITE_SUPABASE_URL` to an
address reachable by users' browsers (the LAN server's IP or DNS name), not
`localhost` on each user's computer. `SUPABASE_URL` is used by server-side
application code and may instead be an address reachable from the app
container. Never copy the hosted production service-role key into a local
deployment.

## Required rollout phases

1. **Local backend and schema:** provision a version-pinned self-hosted
   Supabase stack on the LAN host. Apply the complete, ordered ERP migrations
   to a clean database, including Auth, Realtime, Storage, RLS, extensions,
   scheduled jobs, and server-side functions. Verify tenant isolation and
   financial invariants before importing any business data.
2. **LAN application and identity:** configure every client to use the LAN
   Supabase endpoint. Verify LAN-only login, password changes, role changes,
   backup/restore, and all business operations. Expire offline cached access
   after 30 days; never bypass database authorization to make cached UI work.
3. **Cloud recovery copy:** establish a tested, one-way backup/replication
   pipeline with checkpoints, retention, restore drills, and visible lag/error
   status. Keep cloud business writes disabled while the LAN instance is
   authoritative. Do not use two writable databases or merge financial
   entries by timestamp.
4. **Disconnected client behavior:** allow a device disconnected from the LAN
   to browse its permitted cache only. Queue only explicitly supported,
   idempotent changes; show them as pending and require review when the LAN
   server reports a conflict. Stock, IMEI, invoice numbering, accounting, and
   other multi-step RPCs remain unavailable until an atomic server-side
   conflict protocol is implemented and tested.

## Security and operational gates

- Keep the service-role key and database credentials server-side; never put
  them in `VITE_*` variables, a browser bundle, or a checked-in `.env` file.
- Bind administrative dashboards and database ports to trusted networks only;
  use TLS and a firewall when clients connect across untrusted networks.
- Provision the self-hosted Auth issuer, redirect URLs, JWT signing keys,
  SMTP, Storage limits, Realtime, cron, and backup encryption explicitly.
- Test migration upgrades and restores on a disposable copy before touching
  the live hosted database. A schema dump alone does not copy Auth users,
  Storage objects, secrets, or scheduled-job configuration.
- Never point the desktop wrapper at a hosted URL and describe it as an
  offline local installation.

## Current blocker

The hosted Dockerized application remains on port 3000. All 55 ordered ERP
migrations are applied to the separate local Supabase database, and its Auth,
REST, Realtime, Storage, Studio, and database endpoints have passed health
checks. On this Windows Docker Desktop setup, start the backend with
`supabase start --workdir . --exclude edge-runtime`; the Edge Runtime currently
fails its health check with HTTP 503 and is excluded. The Docker log collector
is healthy after enabling Docker Desktop's local TCP API.

Run `.\scripts\local\start-local-app.ps1` from PowerShell to build and launch a
second app at `http://127.0.0.1:3001`. It gets local Supabase keys from the CLI
and writes them only to the ignored `.env.local-docker.generated` file. The
hosted app and its `.env` configuration remain unchanged. The local database
starts empty and does not contain hosted users or business data. Do not import
or enter live financial data until the local workflow has been validated.

There is currently no local-to-cloud synchronization. The intended direction
is local-authoritative, one-way recovery/replication to the cloud; do not enable
independent cloud writes or use bidirectional replication. A safe sync design
must define durable checkpoints, idempotent delivery, dependency ordering,
Auth/Storage handling, conflict rules, encryption, retention, and tested
restore procedures before business data is sent to the cloud.
