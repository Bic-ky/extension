from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
import uuid
import bcrypt
import datetime

from db_connection import get_db
import models, schemas
from auth_utils import get_current_user, create_jwt
from email_service import send_verification_email

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    limiter = Limiter(key_func=get_remote_address)
    HAS_LIMITER = True
except ImportError:
    HAS_LIMITER = False

router = APIRouter(prefix="/api/auth", tags=["Auth"])

def build_user_response(user, db):
    user_packages = db.query(models.UserPackage).join(models.Package).filter(
        models.UserPackage.user_id == user.id
    ).all()
    packages_list = []
    for up in user_packages:
        pkg = db.query(models.Package).filter(models.Package.id == up.package_id).first()
        if pkg:
            packages_list.append({"name": pkg.name, "display_name": pkg.display_name, "status": up.status})
    
    field_configs = db.query(models.UserFieldConfig).filter(
        models.UserFieldConfig.user_id == user.id
    ).all()
    field_config_dict = {fc.field_name: fc.enabled for fc in field_configs}
    
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "email_verified": user.email_verified,
        "packages": packages_list,
        "field_config": field_config_dict,
    }

if HAS_LIMITER:
    @router.post("/login")
    @limiter.limit("5/minute")
    def login(request: Request, req: schemas.LoginRequest, db: Session = Depends(get_db)):
        return _do_login(req, db)
else:
    @router.post("/login")
    def login(req: schemas.LoginRequest, db: Session = Depends(get_db)):
        return _do_login(req, db)

def _do_login(req, db):
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not bcrypt.checkpw(req.password.encode("utf-8"), user.password_hash.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
        
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email first")
        
    if user.status == "deactivated":
        raise HTTPException(status_code=403, detail="Account is deactivated")
        
    token = create_jwt(user.id, user.email, user.role)
    return schemas.TokenResponse(
        access_token=token,
        token_type="bearer",
        user=build_user_response(user, db)
    )

@router.get("/verify")
def verify(token: str, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.verification_token == token).first()
    if not user:
        raise HTTPException(status_code=404, detail="Invalid or expired token")
    
    # Check token expiry
    if user.verification_token_expires_at and user.verification_token_expires_at < datetime.datetime.utcnow():
        raise HTTPException(status_code=410, detail="Verification token has expired. Please request a new one.")
        
    user.email_verified = True
    user.verification_token = None
    user.verification_token_expires_at = None
    db.commit()
    return HTMLResponse(content="<h1>Email successfully verified!</h1><p>You may now log in to the application.</p>")

if HAS_LIMITER:
    @router.post("/resend-verification")
    @limiter.limit("3/minute")
    def resend_verification(request: Request, req: schemas.ResendVerificationRequest, db: Session = Depends(get_db)):
        return _do_resend(req, db)
else:
    @router.post("/resend-verification")
    def resend_verification(req: schemas.ResendVerificationRequest, db: Session = Depends(get_db)):
        return _do_resend(req, db)

def _do_resend(req, db):
    user = db.query(models.User).filter(models.User.email == req.email).first()
    if not user:
        return {"message": "If the email is registered, a verification link has been sent."}
        
    if user.email_verified:
        return {"message": "Email is already verified."}
        
    user.verification_token = uuid.uuid4().hex
    user.verification_token_expires_at = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    db.commit()
    
    send_verification_email(user.email, user.full_name, user.verification_token)
    return {"message": "Verification email sent."}

@router.get("/me")
def get_me(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return build_user_response(current_user, db)
