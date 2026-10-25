# Threat model

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Proxy credentials (UUIDs, passwords, SS keys, WireGuard private keys) | `storage.local`, in the persisted document | Full access to the user's proxy account/service |
| Proxy endpoint + active state | `storage.local`, browser proxy settings | Deanonymisation, traffic redirection |
| Subscription URLs | `storage.local` | Often contain a per-user token in the path |
| The user's pre-existing proxy configuration | `runtime.snapshot` | Includes PAC scripts, corporate proxies, Tor |
| Exported files | User's disk | Can leak every secret at once |

## Adversaries and threats

### T1 — A malicious or compromised subscription URL

*Vector:* the user adds an attacker-controlled subscription; the response is a crafted
client config or link list.

*Mitigations:* the body is treated as untrusted text and parsed with bounded input
(1 MiB cap), explicit scheme allow-listing, and no evaluation of any kind. A profile is
never auto-connected on import: fetching a subscription updates the list, and the user
still chooses what to route through. Unknown parameters are preserved as opaque strings
rather than interpreted. JSON is parsed, never `eval`'d.

*Residual:* a subscription can still suggest a hostile proxy endpoint. Connecting to a
proxy inherently trusts that proxy; the UI names the endpoint (host:port) next to the
connect control so the choice is visible.

### T2 — Secret leakage through logs, diagnostics or exports

*Vector:* the user pastes a diagnostic into an issue; a clipboard export is shared.

*Mitigations:* `redact.ts` masks userinfo and known secret fields; Diagnostics renders
redacted values only; the shared export omits credentials unless the user explicitly
enables "include secrets", in which case the UI warns first. `merge`/`console` calls in
the background never receive credential objects.

*Residual:* a full export with secrets enabled is plaintext by design (it must be
re-importable). It is the user's file and the UI says so.

### T3 — Another extension or policy fighting for proxy control

*Vector:* two proxy extensions install; the loser silently fails to apply settings.

*Mitigations:* every apply is preceded by a `levelOfControl` check. `controlled_by_other_extensions` and `not_controllable` (enterprise policy) become distinct error codes with actionable text. After writing, the setting is read back and compared; a mismatch rolls back and reports `VERIFY_FAILED` instead of showing a false "connected".

### T4 — Wrong proxy left applied after a crash or update

*Vector:* the worker is killed mid-connect; the browser keeps a proxy the extension no longer tracks.

*Mitigations:* `intent` and the captured snapshot are persisted *before* the UI reports success, so recovery has something correct to restore. On update, the background reconciles persisted intent against the live setting and marks the session as needing attention rather than assuming it is active. Disconnect restores the snapshot instead of resetting to `system` mode.

### T5 — Traffic escaping the tunnel (leaks)

*Vector:* WebRTC or a bypassed origin reveals the real IP while "connected".

*Mitigations:* `<local>` is in the default bypass list so loopback works, but the list is visible and editable. On Chromium the extension can set `webRTCIPHandlingPolicy` to `disable_non_proxied_udp`, restoring the previous policy on disconnect; the capability is reported honestly as unavailable on Firefox (where it is a `about:config` setting).

*Residual:* DNS resolution happens inside the proxy for SOCKS5 (`proxyDNS: true` in Firefox; Chromium resolves remotely for SOCKS5), but HTTP proxies may resolve locally depending on the server. This is a property of the proxy, not of the extension, and is documented rather than papered over.

### T6 — Malicious page reaching the privileged API

*Vector:* a web page tries to call the extension's RPC surface.

*Mitigations:* the RPC listener validates the sender: messages must come from this extension's own pages (`sender.id === runtime.id` and an extension-page URL), so content scripts, web pages and other extensions are rejected. No `externally_connectable`, no `web_accessible_resources`, no content script is injected at all. The UI never renders untrusted HTML — profile names and error text go through React text nodes.

### T7 — Supply chain in the built artifact

*Vector:* a compromised dependency ships code into `background.js`.

*Mitigations:* runtime dependencies are three packages (`react`, `react-dom`, `zod`) with a committed lockfile and `npm ci` in CI; the build is a plain Vite bundle with no remote code, `script-src 'self'` in the CSP, no `eval`, and no network calls at build time. CI runs typecheck, lint, unit tests and the Chromium e2e suite before an artifact is produced.

*Residual:* this is not a formal audit. Dependencies are pinned but not verified
against hashes beyond the lockfile.

## Browser permission justification

| Permission | Used for | Could it be narrower? |
| --- | --- | --- |
| `storage` | profiles, settings, restore snapshot | No — this is the product. |
| `proxy` | applying/restoring the proxy | No. |
| `clipboardRead` | one-click paste of a share link into the import dialog | Yes; it is requested because pasting a `vless://` link is the primary import path, and only read on an explicit button press. |
| `privacy` (Chromium) | WebRTC leak guard | Yes; optional behaviour, but the API needs the permission to exist in the manifest. |
| `optional_host_permissions` (http/https) | fetching user-added subscription URLs | **Yes, and it is optional**: no host access is granted at install. The extension asks at the moment the user adds a subscription, and denies cleanly if refused. |

There is no `tabs`, no `<all_urls>` at install, no `webRequest`, no `cookies`, no
`scripting`, and no remote code. Subscription URLs must be `http(s)` and must not embed
credentials; `https` is the default and the only scheme the docs and UI recommend, while
plain `http` is kept for loopback-hosted subscription files. A plain-`http`
subscription can be modified in transit, which is why it is not the documented default.

## Out of scope

- Protecting a user whose device is already compromised (keylogger, malicious OS proxy).
- Anonymity guarantees. A single proxy endpoint is not a anonymity system; the extension
  does not claim otherwise.
- Traffic analysis by the proxy operator.
