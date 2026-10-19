$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$supabase = Get-Command supabase -ErrorAction SilentlyContinue
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $supabase) {
  throw "Supabase CLI is required. Install it before starting the local app."
}
if (-not $docker) {
  throw "Docker CLI is required. Start Docker Desktop before starting the local app."
}

Push-Location $repoRoot
try {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $startOutput = & $supabase.Source start --workdir $repoRoot --exclude edge-runtime 2>&1
    $startExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($startExitCode -ne 0) {
    throw "Local Supabase failed to start (exit code $startExitCode). Inspect Docker service logs and retry."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $status = & $supabase.Source status --workdir $repoRoot --output env 2>&1
    $statusExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($statusExitCode -ne 0) {
    throw "Could not read the local Supabase API keys."
  }

  $values = @{}
  foreach ($line in $status) {
    if ($line.ToString() -match '^([A-Z0-9_]+)=(.*)$') {
      $values[$matches[1]] = $matches[2].Trim('"')
    }
  }

  $publishableKey = $values["PUBLISHABLE_KEY"]
  $serviceRoleKey = $values["SERVICE_ROLE_KEY"]
  if (-not $publishableKey -or -not $serviceRoleKey) {
    throw "Local Supabase did not return the required application keys."
  }

  $envFile = Join-Path $repoRoot ".env.local-docker.generated"
  $envLines = @(
    "VITE_SUPABASE_URL=http://127.0.0.1:54321",
    "VITE_SUPABASE_PUBLISHABLE_KEY=$publishableKey",
    "SUPABASE_SERVICE_ROLE_KEY=$serviceRoleKey"
  )
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText(
    $envFile,
    ([string]::Join([Environment]::NewLine, $envLines) + [Environment]::NewLine),
    $encoding
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $docker.Source compose --env-file $envFile -f docker-compose.yml -f docker-compose.local.yml up -d --build app-local
    $composeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($composeExitCode -ne 0) {
    throw "Could not build or start the local ERP app."
  }

  $composeArgs = @("--env-file", $envFile, "-f", "docker-compose.yml", "-f", "docker-compose.local.yml")
  $healthy = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $containerId = & $docker.Source compose @composeArgs ps -q app-local
    if ($containerId) {
      $health = & $docker.Source inspect --format "{{.State.Health.Status}}" $containerId
      if ($health -eq "healthy") {
        $healthy = $true
        break
      }
      if ($health -eq "unhealthy") {
        throw "The local ERP app failed its Docker health check. Inspect its container logs."
      }
    }
    Start-Sleep -Seconds 2
  }

  if (-not $healthy) {
    throw "The local ERP app did not become healthy within two minutes."
  }

  Write-Host "Local ERP app is ready at http://127.0.0.1:3001"
  Write-Host "It uses the local Supabase database; the hosted app on port 3000 is unchanged."
}
finally {
  Pop-Location
}
