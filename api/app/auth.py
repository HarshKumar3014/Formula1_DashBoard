"""Verify Supabase Auth access tokens (JWTs) sent as `Authorization: Bearer <token>`."""
import logging

import jwt

from .config import SUPABASE_JWT_SECRET, SUPABASE_URL

log = logging.getLogger(__name__)

AUDIENCE = "authenticated"  # Supabase's audience for signed-in users

_jwks = jwt.PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
                        cache_keys=True, lifespan=3600) if SUPABASE_URL else None


class AuthError(Exception):
    pass


def configured() -> bool:
    return bool(_jwks or SUPABASE_JWT_SECRET)


def verify(token: str) -> dict:
    """Return the token's claims (`sub` = Supabase user id) or raise AuthError."""
    if not configured():
        raise AuthError("Sign-in is not configured on this server (set SUPABASE_URL).")
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg == "HS256":
            if not SUPABASE_JWT_SECRET:
                raise AuthError("HS256 tokens need SUPABASE_JWT_SECRET on the server.")
            key, algs = SUPABASE_JWT_SECRET, ["HS256"]
        elif _jwks is not None:
            # never let a symmetric alg reach a public key (alg-confusion)
            key, algs = _jwks.get_signing_key_from_jwt(token).key, ["ES256", "RS256"]
        else:
            raise AuthError(f"Can't verify {alg} tokens without SUPABASE_URL.")
        claims = jwt.decode(token, key, algorithms=algs,
                            audience=AUDIENCE, options={"require": ["sub", "exp"]})
    except AuthError:
        raise
    except jwt.ExpiredSignatureError:
        raise AuthError("Session expired — sign in again.")
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        log.info("rejected token: %s", exc)
        raise AuthError("Invalid sign-in token.")
    return claims
