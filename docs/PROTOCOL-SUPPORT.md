# Protocol support

This extension is a **browser extension**, not a proxy client. That single fact drives
the whole support matrix, so it is stated first.

A browser can only be pointed at a proxy endpoint it already knows how to speak:
SOCKS4, SOCKS5, HTTP CONNECT, and (Chromium only) HTTPS-to-proxy. It cannot terminate
VLESS, VMess, Trojan, Shadowsocks, Hysteria2 or WireGuard — those are tunnelling
protocols that a separate client (Xray, sing-box, v2rayN, v2rayNG, Hiddify, Nekoray…)
implements.

So the extension has two distinct levels of support, and it never pretends one is the
other:

| Level | Meaning | What the UI shows |
| --- | --- | --- |
| **Routable** | The endpoint is a `socks4/5`, `http` or `https` proxy, and the browser proxy API accepts it as-is. | Connect button enabled, traffic actually moves through it. |
| **Managed only** | The link is parsed, validated, stored, edited, exported and de-duplicated, but the browser cannot route it. | Explicit "configuration only" state; the Connect button explains why. |

A profile is routable only when its protocol is itself a proxy family. `connectKind` is
therefore derived from the scheme, never guessed from a string that merely *looks* like
one (`vless://…?type=ws` is a VLESS endpoint, not a SOCKS proxy).

## Matrix

| Scheme | Parsed | Validated | Stored / edited / exported | Routable by the browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `socks5://` | yes | yes | yes | **yes** | Username/password parsed and stored, but see *Credentials* below. |
| `socks4://`, `socks4a` | yes | yes | yes | **yes** | SOCKS4 has no password field; the username is carried as a user ID. |
| `http://` | yes | yes | yes | **yes** | Also covers `https://`-wrapped links that declare `type=http`. |
| `https://` | yes | yes | yes | **Chromium only** | Firefox proxy settings cannot express a TLS connection to the proxy. |
| `vless://` | yes | yes | yes | no | UUID, flow, `reality`, WS/gRPC/H2/QUIC/XHTTP parameters preserved. |
| `vmess://` (base64 JSON, `v2rayN` era) | yes | yes | yes | no | Both the legacy base64-JSON form and the query-string form. |
| `trojan://` | yes | yes | yes | no | Password, SNI, ALPN, `allowInsecure`, WS/gRPC. |
| `ss://` (SIP002 + legacy base64) | yes | yes | yes | no | AEAD method + password, plugin/`plugin-opts` retained verbatim. |
| `ssr://` | yes | yes | yes | no | Base64url-wrapped `host:port:protocol:method:obfs:base64pass`. |
| `hysteria2://`, `hy2://` | yes | yes | yes | no | Port hopping (`mport`) and obfs password preserved. |
| `wireguard://` | yes | yes | yes | no | Stored for export; the browser never sees the keys. |

Anything outside this table is rejected with a specific parse error (never silently
imported as an empty profile).

## Import formats

- one share link per line, with `#name` fragments used as the profile name;
- a whole subscription body, either plain lines or a base64 blob (standard and
  URL-safe alphabet, padding optional);
- a V2Ray/Xray **client config JSON** (`outbounds` + `inbounds`), one profile per
  supported outbound;
- a JSON array of links or of profile objects, as emitted by this extension's own
  export.

Duplicates are detected by a fingerprint over protocol, host, port, credentials,
transport and security, so re-importing a subscription does not multiply profiles.

## Credentials

This is the one place where the browser is stricter than users expect, and the
extension reports it instead of failing at connect time with a generic error.

| Browser | Endpoint credentials | Behaviour |
| --- | --- | --- |
| Chrome (MV3) | not supported | `chrome.proxy` has no auth callback; a credentialed profile is refused with `AUTH_UNSUPPORTED` and a hint to use an unauthenticated endpoint. |
| Firefox (MV3) | not supported | `browser.proxy.settings` has no credential fields. The adapter advertises `authSupported: []` and refuses rather than dropping the password silently. |

Credentials are still **parsed, stored, masked in the UI, redacted from logs and
diagnostics, and omitted from shared exports** — they are part of the configuration,
they just cannot be transmitted by the browser proxy API. To use such an endpoint,
terminate authentication in the local client that exposes the SOCKS/HTTP inbound.

## Verification model

Once a proxy is applied the extension does not stop at "the setting was written". It
issues a real `fetch()` from the background context with `cache: 'no-store'` and
`credentials: 'omit'` to the configured health-check URL, and records the result as
`ok`, `failed` or `skipped`. A `failed` verification is surfaced as *unverified* in the
popup rather than being reported as connected, because the browser proxy stack can
accept a configuration whose endpoint is dead.

The default probe is `https://www.gstatic.com/generate_204`; it is configurable, can be
disabled, and is the only automatic outbound request the extension makes on its own.
