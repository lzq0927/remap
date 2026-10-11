#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/cloud-env.sh"
cd -- "$REMAP_PROJECT_ROOT"

node -e 'if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js >=24 is required")'
required_pnpm="$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).packageManager.split("@")[1]')"
if [[ "$(pnpm --version)" != "$required_pnpm" ]]; then
  echo "Install pnpm $required_pnpm before running cloud setup." >&2
  exit 1
fi
remap_python="${REMAP_PYTHON:-python3}"
"$remap_python" -c 'import sys; assert sys.version_info >= (3, 12), "Python >=3.12 is required for this cloud setup"'

mkdir -p -- "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME"
pnpm install --frozen-lockfile
"$remap_python" -m pip install --upgrade --target solvers/ctmc/.python-deps --no-cache-dir -r solvers/ctmc/requirements.txt
if [[ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
  "$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" --version
else
  pnpm exec playwright install chromium
fi
pnpm bootstrap
PYTHON_EXECUTABLE="$(command -v "$remap_python")" RELIABILITY_REQUIRE_CTMC=1 pnpm run doctor
echo "Cloud setup complete. Source scripts/cloud-env.sh in each new shell."
