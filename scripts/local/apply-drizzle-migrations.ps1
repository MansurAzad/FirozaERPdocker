$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$migrationDirectory = Join-Path $repoRoot "drizzle\migrations"
$config = Get-Content (Join-Path $repoRoot "supabase\config.toml") -Raw
$projectIdMatch = [regex]::Match($config, '(?m)^project_id\s*=\s*"([^"]+)"')
if (-not $projectIdMatch.Success) {
  throw "Could not determine the local Supabase project ID."
}
$databaseContainer = "supabase_db_$($projectIdMatch.Groups[1].Value)"
$supabase = Get-Command supabase -ErrorAction SilentlyContinue
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker -and $env:LOCALAPPDATA) {
  $bundledDocker = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
  if (Test-Path $bundledDocker) {
    $docker = Get-Item $bundledDocker
  }
}

if (-not $supabase) {
  throw "Supabase CLI is required. Install it before applying local migrations."
}
if (-not $docker) {
  throw "Docker CLI is required. Start Docker Desktop and the local Supabase stack first."
}

& $docker.Source info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker is not available. Start Docker Desktop and retry."
}

$guard = 'DO $guard$ BEGIN IF to_regclass(''public.businesses'') IS NOT NULL OR to_regclass(''firoza_local.drizzle_migrations'') IS NOT NULL THEN RAISE EXCEPTION ''Refusing to apply the full ERP migration set to a non-empty or previously attempted local database.''; END IF; END $guard$;'
& $supabase.Source --workdir $repoRoot db query --local $guard
if ($LASTEXITCODE -ne 0) {
  throw "Could not verify a fresh local Supabase database. Run 'supabase start' and use a fresh local database."
}

$initializeSchema = 'CREATE SCHEMA firoza_local;'
& $supabase.Source --workdir $repoRoot db query --local $initializeSchema
if ($LASTEXITCODE -ne 0) {
  throw "Could not initialize the local migration schema."
}

$initializeLedger = 'CREATE TABLE firoza_local.drizzle_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());'
& $supabase.Source --workdir $repoRoot db query --local $initializeLedger
if ($LASTEXITCODE -ne 0) {
  throw "Could not initialize the local migration ledger."
}

$migrations = Get-ChildItem -Path $migrationDirectory -Filter "*.sql" -File |
  Sort-Object -Property Name
if ($migrations.Count -eq 0) {
  throw "No SQL migrations found in $migrationDirectory."
}

foreach ($migration in $migrations) {
  Write-Host "Applying local migration $($migration.Name)"
  $containerMigration = "/tmp/$($migration.Name)"
  & $docker.Source cp $migration.FullName "${databaseContainer}:$containerMigration"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not copy migration $($migration.Name) into the local database container."
  }

  & $docker.Source exec $databaseContainer psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f $containerMigration
  $migrationExitCode = $LASTEXITCODE
  & $docker.Source exec $databaseContainer rm -f $containerMigration *> $null
  if ($migrationExitCode -ne 0) {
    throw "Migration $($migration.Name) failed. The local database is marked as attempted; do not rerun against it. Recreate a disposable local database, then retry."
  }

  $record = "INSERT INTO firoza_local.drizzle_migrations (name) VALUES ('$($migration.Name)');"
  & $supabase.Source --workdir $repoRoot db query --local $record
  if ($LASTEXITCODE -ne 0) {
    throw "Migration $($migration.Name) applied, but its ledger entry failed. Do not rerun against this database."
  }
}

Write-Host "Applied $($migrations.Count) ERP migrations to the local Supabase database."
