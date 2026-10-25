# Security policy

## Reporting

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability
reporting on this repository (*Security* → *Report a vulnerability*), or email the
maintainer listed in `package.json`. Include the version, browser, and reproduction
steps. You can expect an acknowledgement within 7 days.

## In scope

- Escaping the extension sandbox: a web page, content script or other extension reaching
  the privileged RPC surface.
- Secret exposure: credentials appearing in logs, diagnostics, shared exports or error
  messages when the user did not ask for them.
- Proxy state handling: failing open, leaving a proxy applied after a reported failure,
  or reporting *connected* when the setting was rejected.
- Parsing: memory exhaustion, prototype pollution, or code execution from a crafted
  share link or subscription body.
- Subscription fetching: SSRF against local services, or redirects that bypass the
  origin restriction.
- Manifest/permission mistakes that request more access than the feature needs.

## Out of scope

- The security of the proxy server the user chooses; a proxy operator can always
  observe the traffic it carries.
- The fact that V2Ray protocols are not routed in-browser — that is documented in
  [docs/PROTOCOL-SUPPORT.md](docs/PROTOCOL-SUPPORT.md), not a vulnerability.
- Missing proxy authentication: the browser APIs do not expose it, and the extension
  refuses such profiles. See the same document.
- Device-level compromise: a keylogger or a malicious OS proxy defeats any extension.

## Supported versions

Only the latest released version receives fixes. Pre-1.0 builds are development
snapshots and are not supported.

## Design references

- [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) — assets, adversaries, mitigations and
  residual risk.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — why the background is the only writer
  and how capabilities gate what the UI offers.
