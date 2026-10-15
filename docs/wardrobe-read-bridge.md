# Private wardrobe read bridge

The authenticated James gateway adds GET/HEAD `/api/wardrobe` for the existing
wardrobe manifest, or `?photo=<64 lowercase hex reference>` for an owned photo.
It preserves the existing single-owner requireAuth and allowed-host checks.
Only the fixed private wardrobe origin and GET resources are permitted. Requests
are signed with Ed25519; redirects are rejected and response bodies are capped at
24 MiB. Upstream errors are redacted and fail unavailable rather than empty.

Server configuration (Production only):
- `JAMES_WARDROBE_BRIDGE_SECRET`: dedicated random secret, at least 32 UTF-8 bytes.
  Never expose it in source, URLs, logs or browser bundles. A domain-separated
  SHA-256 digest supplies the Ed25519 seed; Node/OpenSSL performs signing using
  RFC 8410 PKCS#8 encoding. This does not reuse the James session/provider keys.
- `JAMES_WARDROBE_SERVICE_TOKEN`: existing supported Sites service credential.
  Send it only to the exact private wardrobe Site through its platform header.

Authenticated `GET /api/wardrobe?bridgeKey=1` returns only protocol, fixed owner
namespace and raw Ed25519 public key in hex. It makes no upstream/storage call.
Pin that key in the wardrobe runtime as `JAMES_BRIDGE_PUBLIC_KEY`; configure
`JAMES_BRIDGE_OWNER_NAMESPACE=james-single-owner-v1` and the independently reviewed
existing `JAMES_BRIDGE_WARDROBE_USER_ID`. Never accept a verification key or target
principal from the incoming request. Wardrobe stores no copy of the signing secret.

Protocol `james-wardrobe-read-ed25519-v2` binds GET, exact resource, fixed owner,
integer millisecond timestamp and 128-bit nonce. The receiver allows +/-60 seconds;
there is no durable replay store, so a captured signed GET can replay in that
window. TLS, no signature logging and no-store responses are required. This
protocol must never be reused for write or paid routes.

The wardrobe receiver must remain behind private Sites dispatch. It injects only
the mapped wardrobe principal into the original read handler; it does not forward
the platform bearer or caller identity headers. Existing photo membership checks
continue to apply. No source records are copied, changed, deleted or migrated.

This release adds the read API boundary only. It does not complete workspace UI,
single live voice routing, Attention ingestion or reminder delivery. Tasks, Mail
refresh, Microsoft/OpenAI credentials and existing UI remain unchanged. New voice,
mailbox, rendering or reminder calls are not part of verification.

Offline validation uses synthetic values and mocked fetch: real Node signing,
WebCrypto verification, the actual James auth gateway, and the built wardrobe
worker. Real platform read verification and physical UI tests remain separate.
