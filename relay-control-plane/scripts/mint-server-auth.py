#!/usr/bin/env python3
"""
Mint an Ed25519 CWT RELAY_SERVER_AUTH token for self-hosted relay-server.

Usage:
    python3 mint-server-auth.py

Outputs three lines:
    RELAY_SERVER_AUTH=<token>    → paste into .env
    RELAY_PUBLIC_KEY=<key>       → paste into .env and relay.toml [[auth]]
    [[auth]] block               → paste into relay.toml

Requirements:
    pip install cryptography

Gotchas this script handles correctly:
    - `kid` is encoded as a CBOR byte-string (0x4b-prefixed for len 11),
      NOT a text-string (0x6b). y-sweet's validator requires the byte-string
      form; encoding as text produces "Invalid token: The key ID did not match".
    - Scope claim uses CBOR negative integer key -80201, not positive 80200,
      per y-sweet-core/src/cwt.rs.
    - Audience claim must match relay.toml [server].url EXACTLY.

Configuration (edit below):
    AUDIENCE: the URL Obsidian clients use to reach relay-server.
    KID:      must match relay.toml [[auth]] key_id.
"""

import base64
import time

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
except ImportError:
    import sys
    print("ERROR: `cryptography` package required. pip install cryptography", file=sys.stderr)
    sys.exit(1)


# --- Configuration ------------------------------------------------------------

AUDIENCE = "http://localhost:8082"   # must match relay.toml [server].url
KID      = "self_hosted"             # must match relay.toml [[auth]].key_id
EXP_SECS = 365 * 24 * 3600           # 1 year


# --- Minimal CBOR encoder -----------------------------------------------------

def cu(n: int) -> bytes:
    """Encode non-negative integer."""
    if n < 24: return bytes([n])
    if n < 256: return bytes([0x18, n])
    if n < 65536: return bytes([0x19]) + n.to_bytes(2, "big")
    if n < 2**32: return bytes([0x1a]) + n.to_bytes(4, "big")
    return bytes([0x1b]) + n.to_bytes(8, "big")


def cn(n: int) -> bytes:
    """Encode negative integer."""
    v = -1 - n
    if v < 24: return bytes([0x20 | v])
    if v < 256: return bytes([0x38, v])
    if v < 65536: return bytes([0x39]) + v.to_bytes(2, "big")
    if v < 2**32: return bytes([0x3a]) + v.to_bytes(4, "big")
    return bytes([0x3b]) + v.to_bytes(8, "big")


def ci(n: int) -> bytes:
    return cu(n) if n >= 0 else cn(n)


def cbs(b: bytes) -> bytes:
    """Encode byte string."""
    L = len(b)
    if L < 24: return bytes([0x40 | L]) + b
    if L < 256: return bytes([0x58, L]) + b
    if L < 65536: return bytes([0x59]) + L.to_bytes(2, "big") + b
    return bytes([0x5a]) + L.to_bytes(4, "big") + b


def cts(s: str) -> bytes:
    """Encode text string."""
    b = s.encode()
    L = len(b)
    if L < 24: return bytes([0x60 | L]) + b
    if L < 256: return bytes([0x78, L]) + b
    return bytes([0x79]) + L.to_bytes(2, "big") + b


def cmap(pairs) -> bytes:
    n = len(pairs)
    head = bytes([0xa0 | n]) if n < 24 else bytes([0xb8, n])
    body = b""
    for k, v in pairs:
        body += (ci(k) if isinstance(k, int) else cts(k)) + v
    return head + body


def carr(items) -> bytes:
    n = len(items)
    head = bytes([0x80 | n]) if n < 24 else bytes([0x98, n])
    return head + b"".join(items)


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


# --- Mint ---------------------------------------------------------------------

def main():
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )

    iat = int(time.time())
    exp = iat + EXP_SECS

    # Protected header: {1:-8 (alg=EdDSA), 4: bstr(KID)}
    # KEY FIX: KID as byte-string, not text-string
    protected_map = cmap([
        (1, ci(-8)),
        (4, cbs(KID.encode())),
    ])
    protected_bstr = cbs(protected_map)

    # Unprotected: empty
    unprotected = cmap([])

    # Payload: {1: iss, 3: aud, 6: iat, 4: exp, -80201: scope}
    payload_map = cmap([
        (1, cts("relay-server")),
        (3, cts(AUDIENCE)),
        (6, ci(iat)),
        (4, ci(exp)),
        (-80201, cts("server")),
    ])
    payload_bstr = cbs(payload_map)

    # Sig_structure per RFC 8152 §4.4
    sig_struct = carr([
        cts("Signature1"),
        protected_bstr,
        cbs(b""),
        payload_bstr,
    ])
    sig = priv.sign(sig_struct)

    # COSE_Sign1 with y-sweet outer tag 61
    inner = carr([protected_bstr, unprotected, payload_bstr, cbs(sig)])
    outer = b"\xd8\x3d" + b"\xd2" + inner

    token = b64u(outer)
    pub_b64 = b64u(pub)

    print(f"# Paste into relay-control-plane/.env:")
    print(f"RELAY_SERVER_AUTH={token}")
    print(f"RELAY_PUBLIC_KEY={pub_b64}")
    print()
    print(f"# Paste into relay-control-plane/relay.toml (replace existing self_hosted auth block):")
    print(f'[[auth]]')
    print(f'key_id = "{KID}"')
    print(f'public_key = "{pub_b64}"')
    print(f'allowed_token_types = ["document", "file", "server", "prefix"]')
    print()
    print(f"# Token expires: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(exp))}")
    print(f"# Audience: {AUDIENCE}")


if __name__ == "__main__":
    main()
