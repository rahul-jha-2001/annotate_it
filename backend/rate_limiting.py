from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import re
from dataclasses import dataclass
from typing import Sequence

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import (
    RATE_LIMIT_EXPORT_PER_MINUTE,
    RATE_LIMIT_GLOBAL_PER_MINUTE,
    RATE_LIMIT_SESSION_PER_MINUTE,
    RATE_LIMIT_UPLOAD_PER_MINUTE,
)


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RateLimitPolicy:
    name: str
    limit: int
    window_seconds: int


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after: int


GLOBAL_POLICY = RateLimitPolicy("global", RATE_LIMIT_GLOBAL_PER_MINUTE, 60)
SESSION_POLICY = RateLimitPolicy("session_creation", RATE_LIMIT_SESSION_PER_MINUTE, 60)
UPLOAD_POLICY = RateLimitPolicy("upload_presign", RATE_LIMIT_UPLOAD_PER_MINUTE, 60)
EXPORT_POLICY = RateLimitPolicy("export_generation", RATE_LIMIT_EXPORT_PER_MINUTE, 60)

_SESSION_PATH = re.compile(r"^/annotate/[^/]+/session$")
_EXPORT_PATH = re.compile(
    r"^/experiments/[0-9a-fA-F-]+/exports(?:/preflight)?$"
)

_INCREMENT_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
"""


def extract_client_ip(
    *,
    client_host: str,
    x_real_ip: str | None,
    trusted_proxy_cidrs: Sequence[str],
) -> str:
    """Resolve a client address without trusting user-supplied forwarding headers."""
    try:
        peer = ipaddress.ip_address(client_host)
    except ValueError:
        return client_host or "unknown"

    trusted = any(
        peer in ipaddress.ip_network(cidr, strict=False)
        for cidr in trusted_proxy_cidrs
    )
    if trusted and x_real_ip:
        try:
            return str(ipaddress.ip_address(x_real_ip.strip()))
        except ValueError:
            pass
    return str(peer)


def _normalized_ip(ip_address: str) -> str:
    try:
        parsed = ipaddress.ip_address(ip_address)
    except ValueError:
        return "unknown"
    if isinstance(parsed, ipaddress.IPv6Address):
        network = ipaddress.ip_network((parsed, 64), strict=False)
        return f"{network.network_address}/64"
    return str(parsed)


def anonymize_ip(ip_address: str, secret: str) -> str:
    normalized = _normalized_ip(ip_address)
    return hmac.new(
        secret.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def policies_for_request(method: str, path: str) -> list[RateLimitPolicy]:
    policies = [GLOBAL_POLICY]
    normalized_method = method.upper()
    if normalized_method == "POST" and _SESSION_PATH.fullmatch(path):
        policies.append(SESSION_POLICY)
    elif normalized_method == "POST" and path == "/uploads/presign":
        policies.append(UPLOAD_POLICY)
    elif normalized_method == "POST" and _EXPORT_PATH.fullmatch(path):
        policies.append(EXPORT_POLICY)
    return policies


class RedisRateLimiter:
    def __init__(self, redis_client, key_prefix: str = "taskglass:rate-limit"):
        self.redis = redis_client
        self.key_prefix = key_prefix

    async def check(
        self,
        client_identifier: str,
        policy: RateLimitPolicy,
    ) -> RateLimitDecision:
        key = f"{self.key_prefix}:{policy.name}:{client_identifier}"
        current, ttl = await self.redis.eval(
            _INCREMENT_SCRIPT,
            1,
            key,
            policy.window_seconds,
        )
        count = int(current)
        retry_after = max(1, int(ttl))
        return RateLimitDecision(
            allowed=count <= policy.limit,
            limit=policy.limit,
            remaining=max(0, policy.limit - count),
            retry_after=retry_after,
        )


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        limiter: RedisRateLimiter,
        enabled: bool,
        secret: str,
        trusted_proxy_cidrs: Sequence[str],
    ):
        super().__init__(app)
        self.limiter = limiter
        self.enabled = enabled
        self.secret = secret
        self.trusted_proxy_cidrs = tuple(trusted_proxy_cidrs)

    async def dispatch(self, request: Request, call_next) -> Response:
        if (
            not self.enabled
            or request.method.upper() == "OPTIONS"
            or request.url.path in {"/health", "/healthz"}
        ):
            return await call_next(request)

        peer_host = request.client.host if request.client else "unknown"
        client_ip = extract_client_ip(
            client_host=peer_host,
            x_real_ip=request.headers.get("x-real-ip"),
            trusted_proxy_cidrs=self.trusted_proxy_cidrs,
        )
        client_id = anonymize_ip(client_ip, self.secret)
        last_decision: RateLimitDecision | None = None

        try:
            for policy in policies_for_request(request.method, request.url.path):
                decision = await self.limiter.check(client_id, policy)
                last_decision = decision
                if not decision.allowed:
                    logger.warning(
                        "rate_limit.exceeded",
                        extra={
                            "client_id": client_id[:12],
                            "policy": policy.name,
                            "method": request.method,
                            "path": request.url.path,
                            "limit": decision.limit,
                            "retry_after": decision.retry_after,
                        },
                    )
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Too many requests"},
                        headers={
                            "Retry-After": str(decision.retry_after),
                            "X-RateLimit-Limit": str(decision.limit),
                            "X-RateLimit-Remaining": str(decision.remaining),
                        },
                    )
        except Exception as exc:
            logger.warning(
                "rate_limit.backend_unavailable",
                extra={"error_type": type(exc).__name__},
            )
            return await call_next(request)

        response = await call_next(request)
        if last_decision is not None:
            response.headers["X-RateLimit-Limit"] = str(last_decision.limit)
            response.headers["X-RateLimit-Remaining"] = str(last_decision.remaining)
            response.headers["X-RateLimit-Reset"] = str(last_decision.retry_after)
        return response
