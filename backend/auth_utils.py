"""
Shared authentication utilities: JWT encoding/decoding and FastAPI dependencies.
"""

import os
import datetime
import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session
from db_connection import get_db
import models

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    raise ValueError("JWT_SECRET environment variable is required")
JWT_ALGORITHM = "HS256"


def create_jwt(user_id: int, email: str, role: str = "user") -> str:
    """Create a signed JWT token with 30-day expiry."""
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=4),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> dict:
    """Decode and verify a JWT token. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> models.User:
    """
    FastAPI dependency that extracts and validates the Bearer token,
    then returns the User ORM object. Raises 401 if anything fails.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = authorization.split(" ", 1)[1]
    payload = verify_jwt(token)

    user = db.query(models.User).filter(models.User.id == payload["user_id"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.status == "deactivated":
        raise HTTPException(status_code=403, detail="Account is deactivated. Contact admin.")

    return user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """FastAPI dependency — ensures the current user has admin role."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def require_package(package_name: str):
    """
    Returns a FastAPI dependency that checks the user has an active
    subscription to the given package (e.g. 'data_scraping', 'db_sync').
    """
    def _dependency(
        current_user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        has_package = (
            db.query(models.UserPackage)
            .join(models.Package)
            .filter(
                models.UserPackage.user_id == current_user.id,
                models.Package.name == package_name,
                models.UserPackage.status == "active",
            )
            .first()
        )
        if not has_package:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. You need an active '{package_name}' package.",
            )
        return current_user
    return _dependency
