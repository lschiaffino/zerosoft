# Deja NSIS 3.13 y nsis_tauri_utils.dll donde los busca tauri-bundler (%LOCALAPPDATA%\tauri\NSIS),
# para que `tauri build` no baje nada. tauri-bundler (crates/tauri-bundler, bundle/windows/nsis)
# los usa tal cual si están los archivos requeridos, NSIS.exe tiene el SHA-1 esperado y la DLL
# también; si no, los vuelve a bajar de releases de GitHub, que a veces responde 504.
#
# Cada archivo se busca en varias fuentes, con reintentos, y solo se acepta con el SHA-1 que fija
# Tauri: el link del release, el mismo archivo por la API de GitHub (otro camino, anduvo con el
# release en 504) y, para el zip, SourceForge (el zip oficial de NSIS 3.13 es el mismo archivo).
#
# Las URLs y los SHA-1 son los de tauri-cli 2.12.4 (package-lock.json). Si se actualiza tauri-cli,
# revisar crates/tauri-bundler/src/bundle/windows/nsis/mod.rs de esa versión y la clave del caché
# en .github/workflows/desktop.yml.
$ErrorActionPreference = 'Stop'

$tools = Join-Path $env:LOCALAPPDATA 'tauri'
$nsis = Join-Path $tools 'NSIS'
$dll = Join-Path $nsis 'Plugins\x86-unicode\additional\nsis_tauri_utils.dll'
$nsisExeSha1 = '6D45D4E8CCF18FE1FDAC9164058F356102A2ECF2'
$zip = @{
  sha1 = 'DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E'
  urls = @(
    'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip',
    'https://api.github.com/repos/tauri-apps/binary-releases/releases/assets/623832696',
    'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip'
  )
}
$utils = @{
  sha1 = '75197FEE3C6A814FE035788D1C34EAD39349B860'
  urls = @(
    'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll',
    'https://api.github.com/repos/tauri-apps/nsis-tauri-utils/releases/assets/345882097'
  )
}

function Sha1($path) { (Get-FileHash -Algorithm SHA1 $path).Hash.ToUpper() }

# Baja el primero que llegue con el SHA-1 esperado. Cada fuente se intenta hasta 4 veces.
function Fetch($spec, $out) {
  foreach ($url in $spec.urls) {
    $headers = @{}
    if ($url -like 'https://api.github.com/*') {
      $headers['Accept'] = 'application/octet-stream'
      if ($env:GH_TOKEN) { $headers['Authorization'] = "Bearer $($env:GH_TOKEN)" }
    }
    for ($i = 1; $i -le 4; $i++) {
      try {
        Invoke-WebRequest -Uri $url -Headers $headers -OutFile $out -UseBasicParsing -TimeoutSec 120 -MaximumRedirection 10
        if ((Sha1 $out) -eq $spec.sha1) { Write-Host "OK $url"; return }
        Write-Host "SHA-1 distinto desde $url"
        break
      } catch {
        Write-Host "Intento $i de $url falló: $($_.Exception.Message)"
        Start-Sleep -Seconds ([Math]::Min(40, 5 * [Math]::Pow(2, $i - 1)))
      }
    }
  }
  throw "No se pudo bajar $out con el SHA-1 esperado"
}

function Ready {
  $exe = Join-Path $nsis 'NSIS.exe'
  (Test-Path $exe) -and ((Sha1 $exe) -eq $nsisExeSha1) -and (Test-Path (Join-Path $nsis 'Bin\makensis.exe')) -and
  (Test-Path $dll) -and ((Sha1 $dll) -eq $utils.sha1)
}

if (Ready) { Write-Host "NSIS ya está en $nsis (caché)"; exit 0 }

$exe = Join-Path $nsis 'NSIS.exe'
if (-not ((Test-Path $exe) -and ((Sha1 $exe) -eq $nsisExeSha1))) {
  if (Test-Path $nsis) { Remove-Item -Recurse -Force $nsis }
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  $zipFile = Join-Path $env:RUNNER_TEMP 'nsis-3.13.zip'
  Fetch $zip $zipFile
  $extracted = Join-Path $tools 'nsis-3.13'
  if (Test-Path $extracted) { Remove-Item -Recurse -Force $extracted }
  Expand-Archive -Path $zipFile -DestinationPath $tools -Force
  Move-Item (Join-Path $tools 'nsis-3.13') $nsis
}
New-Item -ItemType Directory -Force -Path (Split-Path $dll) | Out-Null
Fetch $utils $dll
if (-not (Ready)) { throw 'NSIS incompleto después de bajarlo' }
Write-Host "NSIS listo en $nsis"
