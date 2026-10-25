# Architecture

## Shape of the system

```
┌─────────────────────────── Chrome / Firefox ───────────────────────────┐
│                                                                         │
│  popup.html ─┐                        ┌─ background service worker /     │
│  options.html┴─ React UI ── RPC ─────►│   event page                     │
│                (apps/extension/src)   │                                  │
│                                        │  ┌────────────────────────────┐ │
│                                        │  │ ConnectionController        │ │
│                                        │  │  · serialized command queue │ │
│                                        │  │  · snapshot → apply → verify│ │
│                                        │  │  · health probe             │ │
│                                        │  └───────────┬────────────────┘ │
│                                        │              │ ProxyAdapter     │
│                                        │        ┌─────┴─────┐            │
│                                        │   ChromeProxy   FirefoxProxy   │
│                                        │   (chrome.proxy) (proxy.        │
│                                        │                   settings)    │
│                                        │              │                  │
│                                        │        browser proxy stack      │
│                                        │              │                  │
│                                        │  ┌───────────▼────────────────┐ │
│                                        │  │ DatabaseStore               │ │
│                                        │  │ storage.local + migrations  │ │
│                                        │  └────────────────────────────┘ │
│                                        └──────────────────────────────────┘
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ SOCKS5 / SOCKS4 / HTTP CONNECT
                          ┌─────────▼──────────┐
                          │ local client or    │
                          │ remote proxy       │
                          └────────────────────┘
```

There is no native host, no companion app, no WebSocket bridge. Everything the
extension does happens inside the browser's own extension sandbox, with the browser's
own proxy stack.

## Packages

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `@v2rb/shared` | Domain types, protocol/transport enums, defaults, error codes. Types only at runtime. | — |
| `@v2rb/config-parser` | Share-link and client-config parsing, serialization back to links, redaction helpers, base64. | shared |
| `@v2rb/storage` | Versioned persisted document, migrations, import/export bundles, corruption handling. | shared |
| `@v2rb/adapters` | Browser proxy API abstraction: capabilities, capture, apply, verify, restore, leak protection. | shared |
| `@v2rb/core` | Use-case services: profiles, subscriptions, settings, connection controller, health probe. | shared, parser, storage, adapters |
| `@v2rb/ui` | Design tokens, base/component CSS, presentational React components and icons. | — |
| `apps/extension` | Manifests, build pipeline, background router, popup, options, i18n (en/fa). | all of the above |

The dependency direction is strictly one-way: `core` knows about adapters, storage and
parsing; nothing below `core` knows about React, the DOM, or the extension shell. That
is what allows the controller to be tested against a fake adapter and a fake clock,
with no browser at all.

## Background as the only writer

Every mutation goes through the background context. Popup and options pages never write
to storage; they send a typed RPC message and receive an `AppSnapshot` back:

```
{ type: 'profile/import', text, source } → { ok: true, data: AppSnapshot }
```

Because there is exactly one writer, there is exactly one serialization point. The
controller also keeps an in-memory `queue` promise chain, so two rapid clicks on
"Connect" cannot interleave a capture/apply/restore sequence and leave the browser on a
proxy that the extension no longer believes it set.

State fan-out is a broadcast on the `v2rb:state` channel; every open UI page re-renders
from the same snapshot. After a browser restart the service worker rehydrates from the
persisted `runtime` record — proxy settings live in the browser, so the persisted
`intent` is what allows the extension to explain, rather than guess, the current state.

## Connection lifecycle

1. **Resolve** — load the active profile, reject non-routable protocols, reject kinds
   the browser cannot speak, reject credentials the browser cannot transmit.
2. **Capture** — read the *current* proxy configuration (and WebRTC policy on Chrome)
   into a snapshot, but only if the previous intent was not already "on". This is what
   makes disconnect a true restore instead of a guess at "direct".
3. **Apply** — write `fixed_servers` (Chromium) or `manual` (Firefox) through the
   adapter; a `levelOfControl` check runs first so an enterprise policy or another
   extension produces `CONTROLLED`, not a silent no-op.
4. **Verify** — read the setting back and compare it field by field with what was
   intended. A mismatch is `VERIFY_FAILED` and triggers rollback.
5. **Probe** — run the health check through the proxy; `failed` is displayed as
   *unverified*, never as connected.
6. **Persist** — write `intent: 'on'` and the snapshot so a later disconnect, or a
   browser restart, can restore the pre-extension state.

Disconnect replays step 2's snapshot, restores the WebRTC policy, and marks
`intent: 'off'`. If the browser was killed while connected, the stored snapshot is still
the right thing to restore, so the next start is not locked behind a dead proxy.

## Storage

`chrome.storage.local` / `browser.storage.local` behind a single `Database` document:

```ts
{ schemaVersion: 1, settings, profiles[], subscriptions[], runtime: { intent, snapshot } }
```

- One key, one atomic write; no partially-written multi-key state.
- `migrate(raw)` accepts unknown input and returns the current schema plus a list of
  `StorageIssue`s. A corrupt or future-versioned document is never deleted: the store
  keeps working on defaults and reports the issue in Diagnostics so the user can export
  what survived.
- Secrets (UUIDs, passwords, keys) stay in this document. Nothing is sent to a server by
  the extension itself; subscription URLs are the only user-supplied remote endpoints.

## Build

`apps/extension/scripts/build.mjs` produces `dist/chrome` and `dist/firefox` from the
same source:

- Vite builds the popup and options pages (React, one CSS bundle each).
- A second Vite build emits `background.js` as a single IIFE/ESM bundle with no dynamic
  imports, because a service worker must start from one file.
- Manifests are composed from `base.json` + a browser overlay, so permissions are
  auditable in one place and cannot drift between browsers.
- Icons are generated at build time from a script (no binary blobs in git).

## Design decisions and their reasons

**No proxy core bundled.** Shipping a WASM build of Xray would be a different product:
it would need to be trusted with keys, its size would dwarf the extension, and MV3's
service-worker lifetime rules make long-lived tunnels fragile. The honest product is a
configuration manager plus a real proxy switch, and that is what is built.

**Capabilities are queried, not assumed.** `getCapabilities()` asks the browser what it
can do (proxy API present, settings controllable, incognito access, WebRTC guard) and
the UI is driven by that object. Chrome's denial of proxy credentials and Firefox's
denial of `https://` endpoints are therefore visible facts, not bugs discovered later.

**Restore, never reset.** "Disconnect" restores the captured configuration. Setting
`mode: 'system'` would silently discard a corporate PAC script or a Tor setup the user
had before installing the extension.
