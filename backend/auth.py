import logging
import uuid

from clerk_backend_api import AuthenticateRequestOptions, Clerk, authenticate_request
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import (
    CLERK_AUTHORIZED_PARTIES,
    CLERK_JWT_KEY,
    CLERK_SECRET_KEY,
    PLATFORM_ADMIN_CLERK_USER_IDS,
)
from database import get_db
from logging_config import current_user_id
from models import User
from schemas import UserResponse

router = APIRouter()
logger = logging.getLogger(__name__)


def _authenticate(request: Request) -> str:
    if not CLERK_SECRET_KEY and not CLERK_JWT_KEY:
        logger.error(
            "auth.configuration_missing",
            extra={
                "method": request.method,
                "path": request.url.path,
                "clerk_secret_key_configured": False,
                "clerk_jwt_key_configured": False,
            },
        )
        raise HTTPException(status_code=503, detail="Clerk is not configured")
    try:
        state = authenticate_request(
            request,
            AuthenticateRequestOptions(
                secret_key=CLERK_SECRET_KEY,
                jwt_key=CLERK_JWT_KEY,
                authorized_parties=CLERK_AUTHORIZED_PARTIES,
                accepts_token=["session_token"],
            ),
        )
    except Exception as exc:
        logger.warning(
            "auth.token_verification_failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "error_type": type(exc).__name__,
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc
    if not state.is_signed_in or not state.payload or not state.payload.get("sub"):
        logger.warning(
            "auth.unauthenticated",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": state.status,
                "reason": state.reason,
            },
        )
        raise HTTPException(status_code=401, detail="Authentication required")
    logger.debug(
        "auth.verified",
        extra={"clerk_user_id": state.payload["sub"]},
    )
    return str(state.payload["sub"])


def _profile_for(clerk_user_id: str) -> tuple[str, str, str | None]:
    if not CLERK_SECRET_KEY:
        raise HTTPException(
            status_code=503,
            detail="CLERK_SECRET_KEY is required to create local user profiles",
        )
    try:
        clerk_user = Clerk(bearer_auth=CLERK_SECRET_KEY).users.get(user_id=clerk_user_id)
    except Exception as exc:
        logger.exception(
            "auth.clerk_profile_fetch_failed clerk_user_id=%s error_type=%s",
            clerk_user_id,
            type(exc).__name__,
        )
        raise HTTPException(status_code=502, detail="Could not load the Clerk user") from exc

    primary_email = next(
        (
            address.email_address
            for address in clerk_user.email_addresses
            if address.id == clerk_user.primary_email_address_id
        ),
        None,
    )
    email = primary_email or next(
        (address.email_address for address in clerk_user.email_addresses),
        None,
    )
    if not email:
        raise HTTPException(status_code=422, detail="A verified email address is required")
    display_name = " ".join(
        value for value in (clerk_user.first_name, clerk_user.last_name) if value
    ) or clerk_user.username or email.split("@", 1)[0]
    return email.strip().lower(), display_name, clerk_user.image_url


def _local_user(clerk_user_id: str, db: Session) -> User:
    user = db.query(User).filter_by(clerk_user_id=clerk_user_id).first()
    if user is not None:
        if clerk_user_id in PLATFORM_ADMIN_CLERK_USER_IDS and not user.is_platform_admin:
            user.is_platform_admin = True
            db.commit()
        if user.status != "active":
            logger.warning(
                "auth.local_user_inactive",
                extra={"clerk_user_id": clerk_user_id, "local_user_id": str(user.id)},
            )
            raise HTTPException(status_code=403, detail="Account is not active")
        return user

    email, display_name, avatar_url = _profile_for(clerk_user_id)
    user = db.query(User).filter_by(email=email).first()
    if user is not None:
        if user.clerk_user_id and user.clerk_user_id != clerk_user_id:
            raise HTTPException(status_code=409, detail="Email belongs to another account")
        user.clerk_user_id = clerk_user_id
        user.display_name = display_name
        user.avatar_url = avatar_url
        logger.info(
            "auth.local_user_linked",
            extra={"clerk_user_id": clerk_user_id, "local_user_id": str(user.id)},
        )
    else:
        user = User(
            id=uuid.uuid4(),
            clerk_user_id=clerk_user_id,
            email=email,
            display_name=display_name,
            avatar_url=avatar_url,
            is_platform_admin=(
                db.query(User).count() == 0
                or clerk_user_id in PLATFORM_ADMIN_CLERK_USER_IDS
            ),
        )
        db.add(user)
        logger.info(
            "auth.local_user_created",
            extra={
                "clerk_user_id": clerk_user_id,
                "local_user_id": str(user.id),
                "is_platform_admin": user.is_platform_admin,
            },
        )
    if clerk_user_id in PLATFORM_ADMIN_CLERK_USER_IDS:
        user.is_platform_admin = True
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.exception(
            "auth.local_user_link_failed",
            extra={"clerk_user_id": clerk_user_id, "error_type": type(exc).__name__},
        )
        raise HTTPException(status_code=409, detail="Could not link the Clerk account") from exc
    db.refresh(user)
    if user.status != "active":
        raise HTTPException(status_code=403, detail="Account is not active")
    return user


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    clerk_user_id = _authenticate(request)
    user = _local_user(clerk_user_id, db)
    current_user_id.set(str(user.id))
    logger.info(
        "auth.authenticated",
        extra={"clerk_user_id": clerk_user_id, "local_user_id": str(user.id)},
    )
    return user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    has_token = bool(request.headers.get("Authorization") or request.cookies.get("__session"))
    if not has_token:
        return None
    clerk_user_id = _authenticate(request)
    user = _local_user(clerk_user_id, db)
    current_user_id.set(str(user.id))
    logger.info(
        "auth.optional_identity_linked",
        extra={"clerk_user_id": clerk_user_id, "local_user_id": str(user.id)},
    )
    return user


@router.get("/auth/me", response_model=UserResponse)
def current_user_profile(user: User = Depends(get_current_user)):
    return user
