#!/usr/bin/env bash
set -euo pipefail
remap_codespaces_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bash "$remap_codespaces_root/scripts/setup-cloud.sh"
printf '\nReMAP ready. Run pnpm dev, then open forwarded port 5173.\n'
