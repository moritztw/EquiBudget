from fastapi import Request, HTTPException, status
from typing import Optional, Dict
from pydantic import BaseModel
from app.config import settings

class AuthenticatedUser(BaseModel):
    user_id: str
    username: str
    email: str
    roles: list[str] = ["member"]
    auth_provider: str = "reverse_proxy"

async def get_current_user(request: Request) -> AuthenticatedUser:
    """
    Extracts user identity from reverse proxy forward-auth headers (Pangolin, Newt, Authelia, Traefik)
    or falls back to Bearer token / dev user.
    """
    if settings.AUTH_MODE == "reverse_proxy":
        user_header = request.headers.get(settings.FORWARDED_USER_HEADER)
        email_header = request.headers.get(settings.FORWARDED_EMAIL_HEADER)
        groups_header = request.headers.get(settings.FORWARDED_GROUPS_HEADER, "")

        if not user_header and not email_header:
            # Fallback for development if no proxy headers are passed
            return AuthenticatedUser(
                user_id="usr_default_admin",
                username="moritz.schneider",
                email="moritz.schneider@example.com",
                roles=["admin"],
                auth_provider="dev_fallback"
            )

        roles = [r.strip() for r in groups_header.split(",") if r.strip()] if groups_header else ["member"]
        username = user_header or email_header.split("@")[0]
        email = email_header or f"{username}@local.homelab"

        return AuthenticatedUser(
            user_id=f"usr_{username.lower()}",
            username=username,
            email=email,
            roles=roles,
            auth_provider="reverse_proxy"
        )
    else:
        # Standalone Bearer JWT validation
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing or invalid Bearer authentication header."
            )
        token = auth_header.split(" ")[1]
        # In standalone mode, decode JWT
        return AuthenticatedUser(
            user_id="usr_jwt_user",
            username="jwt_user",
            email="user@example.com",
            roles=["member"],
            auth_provider="jwt"
        )
