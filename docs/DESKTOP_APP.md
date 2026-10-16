# Windows desktop app

The Tauri desktop app opens the hosted ERP at `https://mobilederp.lovable.app`.
It uses the existing authenticated server and database rather than bundling a
second copy of the SSR application.

## Download a Windows installer

Every push to `main` builds an NSIS installer. Open the repository's **Actions**
tab, select **Windows desktop app**, open a successful run, and download the
`firoza-erp-windows-x64` artifact. GitHub keeps this workflow artifact for 30
days.

## Enable signed automatic updates

Tauri requires a signing key to create updates. The public key matching the
maintainer's private key is already configured in
`src-tauri/tauri.conf.json`. Use that same private key for future releases;
generating a different one will prevent existing installs from accepting
updates.

Keep the private key and its backup safe. Never commit it or put it in `.env`.
Add the existing private key contents as the GitHub Actions repository secret
`TAURI_SIGNING_PRIVATE_KEY`; if it has a password, add that separately as
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

For example, PowerShell can send the key file directly to GitHub without
printing it:

```powershell
Get-Content -Raw "$HOME\.tauri\firoza-erp.key" |
  gh secret set TAURI_SIGNING_PRIVATE_KEY --repo MansurAzad/firozaerp
```

Create a versioned release by updating both `version` in
`src-tauri/tauri.conf.json` and `version` in `src-tauri/Cargo.toml` to the same
new semantic version, then push a matching tag such as `v1.0.1`. The signed
release publishes the `.exe`, updater signature, and `latest.json`. Existing
desktop installations check for signed releases when they start and install a
newer version automatically.

The unsigned `main` workflow artifact is for installing/testing the current
desktop shell. It does not publish an update and cannot replace the signed
release channel.
