import os
import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rate_limiting import (
    RateLimitDecision,
    RateLimitPolicy,
    RedisRateLimiter,
    anonymize_ip,
    extract_client_ip,
    policies_for_request,
    RateLimitMiddleware,
)


def test_client_ip_uses_forwarded_value_only_from_trusted_proxy():
    trusted = ["172.16.0.0/12"]

    assert extract_client_ip(
        client_host="198.51.100.9",
        x_real_ip="203.0.113.7",
        trusted_proxy_cidrs=trusted,
    ) == "198.51.100.9"
    assert extract_client_ip(
        client_host="172.18.0.4",
        x_real_ip="203.0.113.7",
        trusted_proxy_cidrs=trusted,
    ) == "203.0.113.7"


def test_client_identifier_is_private_and_groups_ipv6_by_64():
    secret = "stable-test-secret"
    first = anonymize_ip("2001:db8:abcd:1234::1", secret)
    second = anonymize_ip("2001:db8:abcd:1234::ffff", secret)

    assert first == second
    assert "2001:db8" not in first
    assert len(first) == 64
    assert anonymize_ip("198.51.100.1", secret) != anonymize_ip("198.51.100.2", secret)


def test_route_specific_policies_override_only_their_named_bucket():
    session = policies_for_request("POST", "/annotate/share-token/session")
    upload = policies_for_request("POST", "/uploads/presign")
    export = policies_for_request("POST", "/experiments/00000000-0000-0000-0000-000000000001/exports/preflight")
    ordinary = policies_for_request("GET", "/experiments")

    assert [(p.name, p.limit, p.window_seconds) for p in session] == [
        ("global", 120, 60),
        ("session_creation", 10, 60),
    ]
    assert [p.name for p in upload] == ["global", "upload_presign"]
    assert [p.name for p in export] == ["global", "export_generation"]
    assert [p.name for p in ordinary] == ["global"]


@pytest.mark.asyncio
async def test_redis_limiter_returns_counter_and_ttl_without_raw_ip_keys():
    redis = AsyncMock()
    redis.eval.return_value = [3, 41]
    limiter = RedisRateLimiter(redis)
    policy = policies_for_request("GET", "/experiments")[0]

    decision = await limiter.check("a" * 64, policy)

    assert decision == RateLimitDecision(
        allowed=True,
        limit=120,
        remaining=117,
        retry_after=41,
    )
    key = redis.eval.await_args.args[2]
    assert key == f"taskglass:rate-limit:global:{'a' * 64}"
    assert "198.51.100" not in key


def test_middleware_returns_429_headers_and_skips_health_and_options():
    limiter = AsyncMock()
    limiter.check.return_value = RateLimitDecision(
        allowed=False,
        limit=10,
        remaining=0,
        retry_after=37,
    )
    app = FastAPI()
    app.add_middleware(
        RateLimitMiddleware,
        limiter=limiter,
        enabled=True,
        secret="test-secret",
        trusted_proxy_cidrs=["127.0.0.1/32"],
    )

    @app.get("/resource")
    def resource():
        return {"ok": True}

    @app.get("/healthz")
    def health():
        return {"ok": True}

    client = TestClient(app)
    limited = client.get("/resource")
    health = client.get("/healthz")
    options = client.options("/resource")

    assert limited.status_code == 429
    assert limited.json() == {"detail": "Too many requests"}
    assert limited.headers["Retry-After"] == "37"
    assert limited.headers["X-RateLimit-Limit"] == "10"
    assert limited.headers["X-RateLimit-Remaining"] == "0"
    assert health.status_code == 200
    assert options.status_code != 429
    assert limiter.check.await_count == 1



@pytest.mark.asyncio
@pytest.mark.skipif(
    os.getenv("RUN_INTEGRATION") != "1",
    reason="requires local Redis",
)
async def test_real_redis_enforces_limit_and_expiry():
    from redis.asyncio import Redis

    identifier = uuid.uuid4().hex
    prefix = f"taskglass:test-rate-limit:{uuid.uuid4().hex}"
    redis_client = Redis.from_url("redis://localhost:6379/0", decode_responses=True)
    limiter = RedisRateLimiter(redis_client, key_prefix=prefix)
    policy = RateLimitPolicy("integration", 2, 5)
    key = f"{prefix}:integration:{identifier}"

    try:
        first = await limiter.check(identifier, policy)
        second = await limiter.check(identifier, policy)
        third = await limiter.check(identifier, policy)
        ttl = await redis_client.ttl(key)

        assert first.allowed is True
        assert second.allowed is True
        assert third.allowed is False
        assert third.remaining == 0
        assert 1 <= ttl <= 5
    finally:
        await redis_client.delete(key)
        await redis_client.aclose()
