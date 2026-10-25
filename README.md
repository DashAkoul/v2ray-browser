# V2Ray Browser

A Chrome and Firefox extension that **manages V2Ray-style configurations** and
**switches the browser's proxy** to a SOCKS5 / SOCKS4 / HTTP(S) endpoint — with a status
that reflects reality instead of assumptions.

![status](https://img.shields.io/badge/tests-103%20unit%20%2B%20e2e-brightgreen)
![license](https://img.shields.io/badge/license-GPL--3.0--only-blue)
![browsers](https://img.shields.io/badge/browsers-Chromium%20116%2B%20%7C%20Firefox%20140%2B-orange)

## What it does

- **Imports every common share link** — `vless://`, `vmess://`, `trojan://`, `ss://`,
  `ssr://`, `hysteria2://`, `wireguard://`, `socks5://`, `socks4://`, `http://`,
  `https://` — from a single link, a pasted list, a base64 subscription blob, or a full
  V2Ray/Xray client config JSON.
- **Stores and organises** them: rename, edit, tag, group, search, de-duplicate, export
  and re-import. Credentials are masked in the UI and omitted from shared exports.
- **Subscribes** to remote configuration URLs, refreshes on demand or when stale, and
  keeps per-subscription error reporting.
- **Routes browser traffic** through any endpoint the browser can speak, after checking
  the browser's actual capabilities, capturing the previous proxy configuration, and
  verifying that the setting took effect.
- **Proves the connection**: a real request through the applied proxy decides whether the
  status is *connected* or *unverified*.
- **Restores your previous proxy** on disconnect — including a PAC script or corporate
  configuration that existed before installation.
- **English and Persian (RTL)** UI, light/dark/system themes, keyboard accessible.

## What it cannot do — read this first

A browser extension has no raw sockets. It cannot run VLESS, VMess, Trojan,
Shadowsocks, SSR, Hysteria2 or WireGuard. Those configurations are **managed** (parsed,
stored, edited, exported) but **not routable** by the extension, and the UI says so per
profile instead of offering a button that fails.

To route through such a server, run a client that exposes a local SOCKS/HTTP inbound
(Xray, sing-box, v2rayN, v2rayNG, Hiddify, …) and point a `socks5://` or `http://`
profile at it. The extension will switch the browser to it in one click.

Proxy **credentials** cannot be transmitted by `chrome.proxy` (MV3) or
`browser.proxy.settings`; credentialed endpoints are refused with an explanation rather
than silently connected without them. See [docs/PROTOCOL-SUPPORT.md](docs/PROTOCOL-SUPPORT.md).

## Install

### From a build

```bash
npm install
npm run build          # dist/chrome and dist/firefox
npm run icons          # only if you change the icon source
```

**Chrome / Edge / Brave** — `chrome://extensions` → enable *Developer mode* →
*Load unpacked* → select `dist/chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
select `dist/firefox/manifest.json`. For a permanent install, the build must be signed
by AMO (`web-ext sign`); the ID is fixed in the manifest as
`v2ray-browser@dashakoul.github.io`. Firefox 140+ is required because
`optional_host_permissions` (128) and `data_collection_permissions` (140) must both be
honoured for a store submission.

No host permissions are requested at install. Access to a subscription host is requested
at the moment you add that subscription.

## Usage

1. Open the popup, click **Add configuration**, paste one or more share links.
2. Pick a profile. Profiles whose protocol the browser cannot route show a
   *configuration only* badge; connectable endpoints show a **Connect** button.
3. Connect. The popup reports applying → verifying → connected/unverified, with latency.
4. Disconnect to restore whatever proxy configuration was in place before.

Options (`chrome://extensions` → *Details* → *Extension options*) hold the profile list,
subscriptions, settings (language, theme, bypass list, health check, auto-refresh),
diagnostics (capabilities, redacted export, storage health) and about/licence.

## Development

```bash
npm install
npm run typecheck      # tsc, project-wide
npm run lint           # eslint
npm test               # vitest, 103 tests across 6 files
npm run build          # both browser targets
npm run e2e            # Playwright: real Chromium + real SOCKS5 traffic
npm run lint:firefox   # web-ext lint against dist/firefox
npm run verify         # lint + typecheck + test + build
```

Requirements: Node 22.19+ (jsdom 30's `undici` needs it), npm 10+. `npm run e2e`
needs `npx playwright install chromium` once.

### Repository layout

```
apps/extension          manifests, build pipeline, background, popup, options, i18n
packages/shared-types   domain types, protocol enums, defaults, error codes
packages/config-parser  share-link + client-config parsing, serialization, redaction
packages/storage        versioned document, migrations, import/export
packages/browser-adapters  chrome.proxy vs browser.proxy.settings
packages/core           profile/subscription/settings services, connection controller
packages/ui             design tokens, base CSS, components, icons
tests/e2e               Playwright suite with local SOCKS5 and origin servers
docs                    architecture, feasibility, threat model, protocol support
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/FEASIBILITY.md](docs/FEASIBILITY.md),
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) and
[docs/PROTOCOL-SUPPORT.md](docs/PROTOCOL-SUPPORT.md).

## Security

The threat model, permission justification and residual risks are in
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Report vulnerabilities privately — see
[SECURITY.md](SECURITY.md).

## License

GPL-3.0-only. See [LICENSE](LICENSE).
