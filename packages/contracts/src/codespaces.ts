/** Only map loopback endpoints when the browser is already inside a GitHub Codespaces preview. */
const previewHost =
  /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d+)\.(app\.github\.dev|preview\.app\.github\.dev)$/;

export function codespacesBrowserUrl(value: string, browserOrigin: string) {
  try {
    const browser = new URL(browserOrigin),
      endpoint = new URL(value);
    const match = browser.hostname.match(previewHost);
    if (
      !match ||
      browser.protocol !== "https:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      !["http:", "https:"].includes(endpoint.protocol)
    )
      return value;
    const port = Number(
      endpoint.port || (endpoint.protocol === "https:" ? 443 : 80),
    );
    if (!Number.isInteger(port) || port < 1 || port > 65535) return value;
    endpoint.protocol = "https:";
    endpoint.hostname = `${match[1]}-${port}.${match[3]}`;
    endpoint.port = "";
    return endpoint.href;
  } catch {
    return value;
  }
}

export function codespacesViteHosts(env: Record<string, string | undefined>) {
  const name = env.CODESPACE_NAME;
  const domain =
    env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
  const port = Number(env.WEB_PORT || 5173);
  if (
    env.CODESPACES !== "true" ||
    !name ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    !["app.github.dev", "preview.app.github.dev"].includes(domain) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return [];
  return [`${name}-${port}.${domain}`];
}
