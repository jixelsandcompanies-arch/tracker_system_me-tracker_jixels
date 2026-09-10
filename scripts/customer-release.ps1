param(
  [ValidateSet('build', 'update')][string]$Action = 'build',
  [ValidateSet('preview', 'production')][string]$Channel = 'preview',
  [string]$Message = 'Customer approval and vehicle plate updates'
)
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location -LiteralPath $projectDirectory
try {
  # This extracted workspace is inside an unrelated parent Git repository.
  # Limit EAS uploads to this project, respecting its .easignore.
  $env:EAS_NO_VCS = '1'
  $env:EAS_PROJECT_ROOT = $projectDirectory
  $env:EXPO_PUBLIC_DEMO_MODE = 'false'
  $env:EXPO_PUBLIC_JIXELS_API_URL = 'https://tpzebfvhvjsezynqgdns.supabase.co/functions/v1/api'
  $env:EXPO_PUBLIC_EAS_PROJECT_ID = '000c3287-aab6-4be1-858a-3ddf2c670c49'
  & eas whoami
  if ($LASTEXITCODE -ne 0) { throw 'Sign in to the project owner Expo account with eas login, then rerun this command.' }
  if ($Action -eq 'update') {
    & eas update --platform android --channel $Channel --environment $Channel --message $Message
    if ($LASTEXITCODE -ne 0) { throw 'The update was not published.' }
  } else {
    $resultText = & eas build --platform android --profile $Channel --wait --json
    if ($LASTEXITCODE -ne 0) { throw 'The Android build did not complete. No download link was generated.' }
    $build = @($resultText | ConvertFrom-Json)[0]
    if ($build.status -ne 'FINISHED' -or !$build.artifacts.buildUrl) { throw 'EAS did not return a finished build with a download URL.' }
    $artifactDirectory = Join-Path $projectDirectory 'artifacts'
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    [ordered]@{ buildId = $build.id; channel = $Channel; downloadUrl = $build.artifacts.buildUrl; createdAt = (Get-Date).ToUniversalTime().ToString('o') } |
      ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifactDirectory 'customer-download.json') -Encoding utf8
    Write-Output "Customer download: $($build.artifacts.buildUrl)"
  }
} finally { Pop-Location }
