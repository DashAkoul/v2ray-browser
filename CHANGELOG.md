# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-25

First public release.

### Added

- **Configuration import** for `vless://`, `vmess://` (legacy base64-JSON and query
  form), `trojan://`, `ss://` (SIP002 and legacy), `ssr://`, `hysteria2://`/`hy2://`,
  `wireguard://`, `socks5://`, `socks4://`, `http://` and `https://` links — as a single
  link, a line list, a base64 subscription body, a JSON array, or a V2Ray/Xray client
  config (`outbounds`).
- **Configuration management**: create, edit, rename, tag, group, search, duplicate
  detection by endpoint fingerprint, delete, and round-trip export back to share links.
- **Subscriptions**: add a remote URL, fetch with a 1 MiB cap, refresh on demand or when
  stale, per-subscription error state, optional startup auto-refresh.
- **Connection control** for endpoints the browser can actually route: capability
  detection, capture of the previous proxy configuration, apply, read-back verification,
  health probe through the proxy, and true restore on disconnect.
- **Chrome adapter** (`chrome.proxy`, `fixed_servers`) including `levelOfControl`
  handling and an optional WebRTC leak guard via `chrome.privacy`.
- **Firefox adapter** (`browser.proxy.settings`, `manual`) including private-window
  access detection and `proxyDNS` for SOCKS5.
- **Bilingual UI** (English, Persian/RTL) with light, dark and system themes, and a
  design-system package shared by popup and options.
- **Diagnostics**: live capabilities, storage schema state, redacted configuration
  export, and connection history for the current session.
- **Export/import** of the full database as a versioned JSON bundle; credentials are
  excluded unless explicitly included.
- **Storage migrations** with corrupt/future-document handling that preserves data
  instead of wiping it.
- **Tests**: 103 unit tests across the parser, storage, adapters and core services, plus a
  Playwright suite that loads the real extension in Chromium and proves traffic flows
  through a local SOCKS5 server.

### Known limitations

- VLESS, VMess, Trojan, Shadowsocks, SSR, Hysteria2 and WireGuard are stored, edited and
  exported, but cannot be routed by a browser extension. See
  [docs/PROTOCOL-SUPPORT.md](docs/PROTOCOL-SUPPORT.md).
- Proxy authentication is not available: Chromium exposes no auth callback in MV3 and
  Firefox's proxy settings have no credential fields. Credentialed endpoints are refused
  with an explanation.
- Firefox cannot route through an `https://` proxy endpoint.
- Firefox cannot set the WebRTC leak policy; the Chrome-only guard reports itself as
  unavailable there.

[1.0.0]: https://github.com/dashakoul/v2ray-browser/releases/tag/v1.0.0
