# Feasibility analysis

The brief asks for a "V2Ray proxy manager" as a browser extension. Before writing code,
the question that decides the product is: **which part of a V2Ray client can a browser
extension actually be?** This document records the answer and the evidence behind it,
because it determines every capability claim in the UI.

## What is verifiably possible

| Capability | Why it works | Where it is implemented |
| --- | --- | --- |
| Parse every common share link | Pure string/base64/JSON work; no network needed. | `packages/config-parser` |
| Parse a V2Ray client config (`outbounds`) | Plain JSON transformation. | `parseClientConfig` |
| Store, edit, tag, deduplicate, search profiles | `storage.local` + a versioned document. | `packages/storage`, `packages/core` |
| Import/export with secret redaction | Serialization plus an explicit "include secrets" switch. | `storage/export.ts`, `config-parser/redact.ts` |
| Fetch a subscription URL | `fetch()` from the background with an optional host permission granted at runtime. | `core/subscriptions.ts` |
| Route browser traffic through SOCKS5/SOCKS4/HTTP(S) | `chrome.proxy` / `browser.proxy.settings` are first-class APIs. | `packages/browser-adapters` |
| Know whether the proxy actually works | A real `fetch()` after apply, from the proxied context. | `core/health.ts` |
| Restore the user's previous proxy on disconnect | Read-before-write snapshot, replayed later. | `core/connection.ts` |
| Bilingual RTL/LTR UI | Plain i18n dictionary + `dir` attribute. | `apps/extension/src/i18n` |

## What is not possible, and why

**Running VLESS/VMess/Trojan/SS/Hysteria2/WireGuard inside the extension.** These
protocols require a TCP (or UDP/QUIC) socket, TLS with custom fingerprints, and in
`REALITY`'s case a full TLS handshake impersonation. Extension JavaScript has no raw
socket API. MV3 service workers cannot open one either; `chrome.sockets` is
Chrome-Apps-only and removed. A WebAssembly core could theoretically do the crypto, but
it would still have no socket to write to, and would have to tunnel over `fetch`
streaming — which does not survive MV3 worker suspension.

*Consequence:* the extension is a **manager** for those protocols and a **switch** for
endpoint families the browser speaks natively. Anything else would be a simulation, and
the brief explicitly forbids simulating important capabilities.

**Sending proxy credentials.** `chrome.proxy` has no authentication callback in MV3 (the
old `onAuthRequired` blocking path went away with MV2). `browser.proxy.settings` has no
credential fields at all. Firefox *can* intercept auth challenges with blocking
`webRequest`, but doing so means holding plaintext credentials and answering challenges
for arbitrary hosts — a meaningful attack surface for a small gain. The extension
therefore reports `authSupported: []` and refuses credentialed endpoints with an
explanatory error instead of dropping the password silently.

**TLS to the proxy in Firefox.** Firefox's manual proxy settings express `http`, `ssl`
and `socks` endpoints, where `ssl` means "use this proxy for HTTPS destinations", not
"speak TLS to the proxy". A profile needing `https://proxy` is Chromium-only, and the
capability model says so.

**Applying a proxy to private windows without permission.** Firefox requires
`isAllowedIncognitoAccess()`; without it, `proxy.settings.set` is rejected. Surfaced as
`FIREFOX_INCOGNITO_REQUIRED` with the exact fix.

**Proving egress optimistically.** A configuration can be accepted by the browser and
still be dead. Hence the post-apply probe; "connected" without a successful probe is
labelled *unverified*.

## Evidence

- `packages/*/tests` — 103 unit tests covering parsing of every listed scheme, client
  config import, storage migration from corrupt/future documents, capability gating,
  capture/apply/verify/restore ordering, rollback on verify failure, subscription
  refresh and redaction.
- `tests/e2e` — Playwright against the real Chromium build with the unpacked extension:
  adds a config through the UI, connects through a **real SOCKS5 server** implemented in
  the fixture, asserts that a page request arrives at the fixture's origin *from the
  SOCKS server* (not directly), then disconnects and asserts the original proxy settings
  are restored.
- `dist/firefox` is linted with `web-ext lint` in CI, so Firefox-specific manifest
  problems are caught rather than assumed away.

## Scope consequences

Because the browser cannot route V2Ray protocols, the product's honest promise is:

> Manage your V2Ray configurations in the browser, and switch the browser's proxy to any
> local or remote SOCKS/HTTP endpoint in one click — with a truthful status for both.

That is useful on its own (many users run Xray/sing-box locally and only need the
browser to use its inbound), and it is the maximum that can be delivered without shipping
a separate binary.
