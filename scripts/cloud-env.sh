# Source this file in a Bash shell before running ReMAP cloud commands.
# Keep writable tool state beside the checkout, without changing HOME or proxies.
REMAP_PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export REMAP_CLOUD_RUNTIME="${REMAP_CLOUD_RUNTIME:-$REMAP_PROJECT_ROOT/.local-runtime}"
export XDG_DATA_HOME="$REMAP_CLOUD_RUNTIME/share"
export XDG_CACHE_HOME="$REMAP_CLOUD_RUNTIME/cache"
export XDG_CONFIG_HOME="$REMAP_CLOUD_RUNTIME/config"
export XDG_STATE_HOME="$REMAP_CLOUD_RUNTIME/state"
export PLAYWRIGHT_BROWSERS_PATH="$XDG_CACHE_HOME/ms-playwright"
if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]] && command -v chromium >/dev/null 2>&1; then
  export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(command -v chromium)"
fi

# Installation and local integration checks do not require external model calls.
export OPENCODE_DISABLE_AUTOUPDATE="${OPENCODE_DISABLE_AUTOUPDATE:-true}"
export OPENCODE_DISABLE_MODELS_FETCH="${OPENCODE_DISABLE_MODELS_FETCH:-true}"
export OPENCODE_DISABLE_DEFAULT_PLUGINS="${OPENCODE_DISABLE_DEFAULT_PLUGINS:-true}"
