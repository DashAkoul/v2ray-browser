# Contributing

## Ground rules

1. **Never simulate a capability.** If something cannot work in a browser, it must be
   labelled as such in the UI and in `docs/`. A button that pretends is worse than no
   button.
2. **State what was verified.** A change that affects routing must come with a test that
   proves the traffic moved (or that the refusal happened for the right reason).
3. **No new runtime dependency without a reason.** The extension ships `react`,
   `react-dom` and `zod`. Anything else needs justification in the PR.

## Setup

```bash
npm install
npm run verify        # lint + typecheck + tests + build
npm run e2e           # after: npx playwright install chromium
npm run lint:firefox
```

Load `dist/chrome` as an unpacked extension, or `dist/firefox/manifest.json` via
`about:debugging`, after any `npm run build`.

## Project conventions

- TypeScript strict mode, no `any` (use `unknown` + narrowing).
- Domain types belong in `@v2rb/shared`; a type used by only one package stays there.
- Nothing below `@v2rb/core` may import React or touch `document`/`window`.
- The background context is the only writer. UI code sends RPC messages; it never writes
  to storage directly.
- User-facing strings go through `apps/extension/src/i18n` — add both `en` and `fa` keys.
  The `fa` dictionary is typed against `en`, so a missing key fails typecheck.
- Errors crossing a boundary carry a stable code (`ConnectionErrorCode`, `AppError`), not
  just a message.
- Commits follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Adding a protocol

1. Extend `PROTOCOLS` in `packages/shared-types`.
2. Add the parse branch in `packages/config-parser/src/links.ts` (or `client-config.ts`
   for outbound JSON) plus a serialization branch in `serialize.ts` if it can be
   re-exported.
3. Add fixtures to `packages/config-parser/tests/`.
4. Add the row to `docs/PROTOCOL-SUPPORT.md`.
5. **Do not** add it to `CONNECT_KINDS`. The browser cannot speak it; it stays managed
   only unless the browser proxy API genuinely supports it.

## Testing expectations

| Area | Requirement |
| --- | --- |
| Parser | A test per accepted format **and** per rejection reason. |
| Storage | Migration from the previous schema and from corrupt input. |
| Adapters | Capability gating, apply/verify mismatch, restore fidelity. |
| Connection controller | Ordering, rollback, concurrent connect, recovery after restart. |
| UI behaviour | Playwright if it changes what a user can accomplish; otherwise a unit test. |

Tests must not depend on the public internet or on a real proxy. `tests/e2e/fixtures`
starts local SOCKS5 and origin servers; use those.

## Pull requests

- One concern per PR; describe the user-visible effect and the evidence.
- `npm run verify` must pass, and the e2e suite for anything touching routing,
  manifests, or the background router.
- Update `CHANGELOG.md` under `Unreleased` for user-visible changes.
- Screenshots for UI changes are welcome but never a substitute for the test.
