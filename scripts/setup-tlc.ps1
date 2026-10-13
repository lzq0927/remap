param([string]$RuntimeDirectory = (Join-Path $PSScriptRoot '../.local-runtime/tlc'))
$ErrorActionPreference = 'Stop'
$target = [System.IO.Path]::GetFullPath($RuntimeDirectory)
New-Item -ItemType Directory -Path $target -Force | Out-Null
$javaUrl = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip'
$javaSha = 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636'
$jarUrl = 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar'
$jarSha1 = 'bee4a54f3ee3d4afc347c3240ec2d9e93b075104'
$zip = Join-Path $target 'java.zip'
$jar = Join-Path $target 'tla2tools.jar'
if (!(Test-Path -LiteralPath $zip)) { Invoke-WebRequest -Uri $javaUrl -OutFile $zip }
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $javaSha) { throw 'Java package checksum mismatch' }
if (!(Test-Path -LiteralPath $jar)) { Invoke-WebRequest -Uri $jarUrl -OutFile $jar }
if ((Get-FileHash -LiteralPath $jar -Algorithm SHA1).Hash.ToLowerInvariant() -ne $jarSha1) { throw 'TLC package checksum mismatch' }
Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
$java = Get-ChildItem -LiteralPath $target -Filter java.exe -Recurse | Where-Object { $_.FullName -match '[\\/]bin[\\/]java.exe$' } | Select-Object -First 1
if (!$java) { throw 'Portable Java missing' }
@{java=$java.FullName; jar=$jar; javaSource=$javaUrl; javaSHA256=$javaSha; tlcSource=$jarUrl; tlcSHA256=(Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant(); tlcVersion='1.7.4'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'runtime.json') -Encoding utf8
& $java.FullName -version
Write-Output "TLC installed in $target"
