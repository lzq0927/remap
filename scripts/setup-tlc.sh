#!/usr/bin/env bash
set -euo pipefail
remap_tlc_project="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
remap_tlc_java="${REMAP_JAVA_BIN:-java}"
if ! command -v "$remap_tlc_java" >/dev/null 2>&1; then
  echo "Install Java 17 or newer, or set REMAP_JAVA_BIN to an approved Java executable." >&2
  exit 1
fi
remap_tlc_java="$(command -v "$remap_tlc_java")"
"$remap_tlc_java" -version
remap_tlc_target="${1:-$remap_tlc_project/.local-runtime/tlc}"
mkdir -p -- "$remap_tlc_target"
remap_tlc_target="$(cd -- "$remap_tlc_target" && pwd)"
remap_tlc_jar="$remap_tlc_target/tla2tools.jar"
remap_tlc_url='https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar'
remap_tlc_sha='936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'
remap_tlc_temp=''
trap 'if [[ -n "$remap_tlc_temp" ]]; then rm -f -- "$remap_tlc_temp"; fi' EXIT
if [[ ! -f "$remap_tlc_jar" ]]; then
  remap_tlc_temp="$(mktemp "$remap_tlc_target/tla2tools.XXXXXX")"
  curl --fail --location --retry 2 --max-time 60 --output "$remap_tlc_temp" "$remap_tlc_url"
  printf '%s  %s\n' "$remap_tlc_sha" "$remap_tlc_temp" | sha256sum --check --status
  mv -- "$remap_tlc_temp" "$remap_tlc_jar"
  remap_tlc_temp=''
fi
if ! printf '%s  %s\n' "$remap_tlc_sha" "$remap_tlc_jar" | sha256sum --check --status; then
  echo "TLC checksum mismatch; the existing file was preserved. Check its origin before replacing it." >&2
  exit 1
fi
node --input-type=module - "$remap_tlc_java" "$remap_tlc_jar" "$remap_tlc_url" "$remap_tlc_sha" <<'JS'
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const [java, jar, tlcSource, tlcSHA256] = process.argv.slice(2);
writeFileSync(join(dirname(jar), 'runtime.json'), JSON.stringify({
  java, jar, tlcSource, tlcSHA256, tlcVersion: '1.7.4',
}, null, 2) + '\n');
JS
printf 'TLC 1.7.4 installed and SHA-256 verified in %s\n' "$remap_tlc_target"
