# Windows desktop app

The Tauri desktop app opens the hosted ERP at `https://firozaenterprise.vercel.app`.
It uses the existing authenticated server and database rather than bundling a
second copy of the SSR application.

## Offline behavior and limits

Typography uses fonts available on the computer, so the interface does not
download fonts or change text metrics after loading.

The app persists successfully loaded TanStack Query data in IndexedDB for the
currently signed-in account. The cache expires after 24 hours, is cleared when
the user signs out or changes account, and is restored before authenticated
routes load. Previously opened pages may be available offline, but data can be
stale and pages/data not loaded on that device are not available.

The service worker caches visited pages and their assets at runtime. Open the
pages needed for an offline session at least once while connected. A valid,
unexpired sign-in session and cached business membership are required to reopen
the authenticated app offline.

Audit reports retain at least the most recent 30 days. Older entries are
removed in small scheduled batches. Database changes produce an optional
in-app notification tone; the speaker control in the app header enables or
disables it on that device. Sound requires a user interaction to unlock in
browser/WebView audio settings.

The audit page supports date-range filtering, numbered pages, full-range CSV
export and printing. It records the acting member, action time, business page,
source table, record ID, and before/after values; sensitive fields such as
passwords and tokens are redacted in the report.

Offline mode is not a second local ERP database. Server functions and RPCs that
post sales, purchases, expenses, stock, balances, or other multi-step operations
still require a connection; they are not safely replayable because they may
return server-generated IDs and must validate current stock, IMEI, permissions,
and balances atomically. The IndexedDB write queue is limited to plain table
writes. A queued item is pending, not yet committed; the server may reject it
when synchronization resumes. Review the Sync History before retrying a failed
write. Use the device's protected OS account because cached ERP data is stored
locally by the browser/WebView.

## Automatic Windows updates

Every push to `main` automatically increments the desktop patch version,
updates both Tauri and Cargo version fields, pushes a matching `vX.Y.Z` tag,
builds a signed NSIS installer, and publishes a GitHub release containing
Tauri's `latest.json` updater manifest and signature. The signed desktop app
checks that public release manifest at startup, verifies available updates
against its configured public key, then downloads and installs them
automatically. Users may also download the `.exe` from the latest GitHub
release to install or update manually.

The repository must keep the `TAURI_SIGNING_PRIVATE_KEY` Actions secret
configured. If the key is encrypted, also configure
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep the private key and its backup safe:
never commit it or put it in `.env`. The matching public key and updater
endpoint are configured in `src-tauri/tauri.conf.json`; keep using the same
signing key for future releases.

For a manually managed release, update both version fields to the same
semantic version and push the matching `vX.Y.Z` tag. The release workflow
publishes the signed installer and updater manifest for that tag.
