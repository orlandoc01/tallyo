# Reverse Proxy

Tallyo serves the SPA, API, OAuth endpoints, and optional MCP endpoint from one
HTTP listener. A typical deployment is:

```text
Browser or MCP client -> HTTPS reverse proxy -> private HTTP Tallyo listener
```

Terminate public TLS at the proxy and keep the Tallyo listener reachable only
from that proxy or a private network. Authentication details are in
[auth.md](auth.md), backup procedures in [backups.md](backups.md), and general
hardening in [security.md](security.md).

## Root Host, Not A Subpath

Give Tallyo a dedicated origin such as `https://tallyo.example.com`. Hosting it
at `https://example.com/tallyo` is not supported. The SPA, PWA scope, OAuth
routes, callback paths, and API requests use root-relative paths.

Forward paths unchanged and send every route to the same Tallyo service. This
includes:

- `/` and SPA asset or client-side routes
- `/query`, `/playground`, and `/transactions/*`
- `/auth/*`, `/authorize`, `/token`, `/consent`, and `/register`
- `/.well-known/*`
- `/mcp`
- `/healthz`

Do not split the frontend and API between different upstreams, strip a prefix,
or rewrite unknown paths to HTML in the proxy. Tallyo's own router handles SPA
fallback after checking its API routes.

## Canonical HTTPS Origin

For `https://tallyo.example.com`, configure these exact values:

```text
OAuth issuer URL:       https://tallyo.example.com
Frontend redirect URI:  https://tallyo.example.com/auth/callback
Google redirect URI:    https://tallyo.example.com/auth/google/callback
WebAuthn RP ID:         tallyo.example.com
WebAuthn RP origins:    https://tallyo.example.com
MCP URL:                https://tallyo.example.com/mcp
```

The issuer is the canonical external origin, not the upstream HTTP URL. If the
public origin has a non-default port, include it in the issuer, frontend and
Google callbacks, and WebAuthn origin. Do not include the port in the WebAuthn
RP ID.

OAuth redirect matching and WebAuthn origin matching are exact. A different
scheme, host, port, path, or trailing slash fails. Tallyo does not reconstruct
these configured URLs from forwarding headers, so correct `X-Forwarded-Proto`
cannot repair an incorrect issuer setting.

## Upstream Exposure

For Docker with a proxy on the host, bind the published port to loopback:

```yaml
services:
  tallyo:
    ports:
      - "127.0.0.1:8080:8080"
```

For Traefik or another proxy container on the same Docker network, omit the
published host port and let the proxy reach container port `8080` over that
dedicated network.

The bare binary listens on all interfaces for its configured `PORT`; there is
no separate listen-address setting. Use host firewall rules, a network
namespace, or a container to limit that port to the reverse proxy or trusted
private clients. Do not expose backend port `8080` alongside the public proxy.

## Forwarded Client Addresses

Tallyo uses the direct peer address for rate limiting unless that peer is in
**Settings -> Security -> Trusted Proxies**. Only then does it inspect
`X-Forwarded-For`, falling back to `X-Real-IP`.

Trust the narrowest possible source:

- For a same-host proxy connected directly over loopback, trust the exact
  loopback address seen by Tallyo, commonly `127.0.0.1/32` or `::1/128`.
- For a proxy container, trust its exact stable address or the dedicated proxy
  network CIDR only when untrusted containers cannot join that network.
- For a load balancer, trust only its documented egress addresses.

Do not enter `0.0.0.0/0`, `::/0`, every private address range, or a broad
Docker range. An overbroad trust list lets a direct client spoof forwarding
headers and evade per-IP limits. Leave the list empty if Tallyo is directly
exposed. Trusted-proxy changes apply live without a restart.

Tallyo walks `X-Forwarded-For` from right to left, skips trusted proxy
addresses, and selects the first untrusted address as the client. Ensure each
proxy appends to the chain rather than accepting a client-supplied value as
authoritative.

## Headers And Authentication

Preserve the original `Host` and forward normal request headers, especially:

- `Authorization` for OAuth bearer tokens
- `X-API-Key` for the master password
- `Content-Type` and `Accept`
- `Cookie` on requests and `Set-Cookie` on responses
- `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Host`, and
  `X-Forwarded-Proto`

Do not place the master password in proxy configuration as a global injected
header. That would turn every request reaching the proxy into an all-scope
request. Also avoid putting API keys in URLs; URLs are commonly retained in
access logs and browser history.

Tallyo does not require WebSocket upgrade support. Standard HTTP/1.1 or HTTP/2
on the client side is sufficient.

## Bodies, Timeouts, Streaming, And Cache

- Tallyo caps GraphQL request bodies at 1 MiB. A proxy may impose the same or a
  larger limit, but should not silently allow less if clients use persisted or
  large queries.
- CSV import uses multipart uploads. Set the proxy body limit high enough for
  the files your household imports; common nginx defaults are too small for
  larger files.
- Tallyo allows GraphQL operations up to 55 seconds and has a 60-second server
  write timeout. Set ordinary proxy upstream timeouts to at least 60 seconds so
  the proxy is not the first component to abort a valid request.
- Do not add proxy caching to API, OAuth, callback, health, or MCP routes.
  Tallyo already sends cache policy for SPA files. If a CDN is unavoidable,
  bypass cache for authenticated requests and all non-asset paths.

MCP uses Streamable HTTP and can return Server-Sent Events on `/mcp`. It does
not use WebSockets. Some clients only exchange short JSON responses, while
others may hold a stream open. Disable response buffering for `/mcp` and allow
an appropriately long idle timeout if your client needs streaming. Proxy
settings cannot override Tallyo's own timeouts or guarantee compatibility with
every MCP client, so test the exact client and proxy version you deploy.

## Health Checks

`GET /healthz` is unauthenticated and returns status `204` with no body. Point
the proxy or orchestrator health check directly at that path and accept `204`
as healthy. Do not require a response body and do not redirect it to a login
page.

## Starting-Point Configurations

These examples are generic starting points, not configurations exercised by
Tallyo's automated tests. Adapt certificate storage, networks, service names,
and timeout policy to your proxy version, then run the checklist below.

### Caddy

Caddy obtains and renews public certificates automatically when DNS and ports
are correctly configured:

```caddyfile
tallyo.example.com {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

Caddy sets standard `X-Forwarded-*` headers and forwards authentication headers
by default. If Caddy is the direct loopback peer, add only its observed
loopback address to Tallyo's trusted proxies.

### Traefik Docker Labels

This assumes Traefik and Tallyo share a Docker network named `proxy`, and
Traefik already owns the `websecure` entry point and certificate resolver:

```yaml
services:
  tallyo:
    networks:
      - proxy
    labels:
      - traefik.enable=true
      - traefik.docker.network=proxy
      - traefik.http.routers.tallyo.rule=Host(`tallyo.example.com`)
      - traefik.http.routers.tallyo.entrypoints=websecure
      - traefik.http.routers.tallyo.tls=true
      - traefik.http.services.tallyo.loadbalancer.server.port=8080
      - traefik.http.services.tallyo.loadbalancer.healthcheck.path=/healthz
      - traefik.http.services.tallyo.loadbalancer.healthcheck.interval=30s
      - traefik.http.services.tallyo.loadbalancer.healthcheck.timeout=3s

networks:
  proxy:
    external: true
```

Do not publish Tallyo's port when Traefik reaches it over this network. Trust
only Traefik's exact address or this dedicated network's narrow CIDR, not all
Docker networks. Verify MCP streaming behavior with the Traefik release in
use; no WebSocket labels are needed.

### nginx

The example uses a host-local Tallyo upstream. The certificate paths are
generic placeholders for files managed by your normal ACME or certificate
tooling:

```nginx
server {
    listen 443 ssl http2;
    server_name tallyo.example.com;

    ssl_certificate     /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;

    client_max_body_size 25m;

    location = /mcp {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-API-Key $http_x_api_key;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-API-Key $http_x_api_key;
        proxy_read_timeout 65s;
    }
}
```

The 25 MiB body limit is an operator-selected example for CSV uploads, not a
Tallyo limit. Increase or reduce it for your deployment. The one-hour MCP
proxy timeout only prevents nginx from being the first idle timeout; Tallyo and
the client still impose their own limits.

## Troubleshooting Checklist

1. Request the backend directly from the proxy host or container and confirm
   `GET /healthz` returns `204`.
2. Request `https://tallyo.example.com/healthz` and confirm the proxy also
   returns `204` without a redirect or HTML body.
3. Confirm the browser address origin exactly matches OAuth issuer URL,
   frontend redirect URI, Google redirect URI, and WebAuthn origin.
4. If OAuth says redirect mismatch, compare scheme, host, port, path, URL
   encoding, and trailing slash. The frontend callback is `/auth/callback`;
   Google's callback is `/auth/google/callback`.
5. If passkeys fail, verify HTTPS, RP ID without a port, exact RP origin, device
   support, and whether the hostname changed after credentials were created.
6. If every user appears to share one rate limit, inspect Tallyo's direct peer,
   the `X-Forwarded-For` chain, and the narrow trusted-proxy entry.
7. If authentication returns `401`, verify `Authorization` and `X-API-Key`
   reach the upstream unchanged and that an authorization-setting restart
   completed under a process supervisor.
8. If an API request returns the SPA HTML, remove proxy path rewrites and
   forward all named routes to Tallyo unchanged.
9. If uploads return `413`, raise the proxy body limit. If long GraphQL calls
   return `504`, ensure the proxy timeout is at least 60 seconds.
10. If MCP returns `404`, enable MCP in Tallyo. For `401`, fix bearer or API-key
    forwarding. For dropped streams, disable buffering and inspect proxy,
    client, and Tallyo timeout logs. Do not add WebSocket rules.
11. If stale HTML or authentication responses appear, disable proxy or CDN
    caching for non-asset paths and retry in a private browser session.
