from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import uuid
import bcrypt
import datetime

from db_connection import get_db
import models, schemas
from auth_utils import require_admin
from email_service import send_verification_email
from routers.auth import build_user_response

router = APIRouter(prefix="/api/admin", tags=["Admin"])

OPTIONAL_FIELDS = [
    "Vehicle_Plate_Number", "Vehicle_Detail", "Subvention_Bonus",
    "Promotion_Compensation", "Total_GPS_Mileage", "Active_Mileage",
    "Idle_Mileage", "Offline_Mileage"
]

@router.post("/users")
def create_user(req: schemas.CreateUserRequest, admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")
        
    hashed = bcrypt.hashpw(req.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    verification_token = uuid.uuid4().hex
    
    new_user = models.User(
        full_name=req.full_name,
        email=req.email,
        password_hash=hashed,
        role="user",
        status="active",
        email_verified=False,
        verification_token=verification_token,
        verification_token_expires_at=datetime.datetime.utcnow() + datetime.timedelta(hours=24),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Always assign data_scraping by default
    scraping_pkg = db.query(models.Package).filter(models.Package.name == "data_scraping").first()
    if scraping_pkg:
        up = models.UserPackage(user_id=new_user.id, package_id=scraping_pkg.id, status="active")
        db.add(up)
        
    if req.package_names:
        for pkg_name in req.package_names:
            if pkg_name == "data_scraping":
                continue # Already added
            pkg = db.query(models.Package).filter(models.Package.name == pkg_name).first()
            if pkg:
                up = models.UserPackage(user_id=new_user.id, package_id=pkg.id, status="active")
                db.add(up)
    
    for field_name in OPTIONAL_FIELDS:
        fc = models.UserFieldConfig(user_id=new_user.id, field_name=field_name, enabled=False)
        db.add(fc)
        
    db.commit()
    
    send_verification_email(new_user.email, new_user.full_name, verification_token)
    
    return build_user_response(new_user, db)

@router.get("/users")
def get_users(admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    return [build_user_response(u, db) for u in users]

@router.put("/users/{user_id}/status")
def update_user_status(user_id: int, req: schemas.UpdateUserStatusRequest, admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.status = req.status
    db.commit()
    return build_user_response(user, db)

@router.put("/users/{user_id}/packages")
def update_user_packages(user_id: int, req: schemas.AssignPackagesRequest, admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    for pkg_name in req.package_names:
        pkg = db.query(models.Package).filter(models.Package.name == pkg_name).first()
        if pkg:
            existing_up = db.query(models.UserPackage).filter(
                models.UserPackage.user_id == user.id,
                models.UserPackage.package_id == pkg.id
            ).first()
            if existing_up:
                existing_up.status = "active"
            else:
                new_up = models.UserPackage(user_id=user.id, package_id=pkg.id, status="active")
                db.add(new_up)
    db.commit()
    return build_user_response(user, db)

@router.delete("/users/{user_id}/packages/{package_name}")
def remove_user_package(user_id: int, package_name: str, admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    pkg = db.query(models.Package).filter(models.Package.name == package_name).first()
    if pkg:
        db.query(models.UserPackage).filter(
            models.UserPackage.user_id == user.id,
            models.UserPackage.package_id == pkg.id
        ).delete()
        db.commit()
    return build_user_response(user, db)

@router.get("/db-requests")
def get_db_requests(admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    requests = db.query(models.DatabaseAccessRequest).all()
    result = []
    for r in requests:
        user = db.query(models.User).filter(models.User.id == r.user_id).first()
        if user:
            result.append({
                "id": r.id,
                "user_id": user.id,
                "user_name": user.full_name,
                "user_email": user.email,
                "access_type": r.access_type,
                "custom_db_url": r.custom_db_url,
                "status": r.status,
                "requested_at": r.created_at
            })
    return result

class UpdateDBRequestStatus(schemas.BaseModel):
    status: str

@router.put("/db-requests/{request_id}")
def update_db_request(request_id: int, req: UpdateDBRequestStatus, admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    db_req = db.query(models.DatabaseAccessRequest).filter(models.DatabaseAccessRequest.id == request_id).first()
    if not db_req:
        raise HTTPException(status_code=404, detail="DB access request not found")
        
    db_req.status = req.status
    db.commit()
    
    if req.status == "approved":
        user = db.query(models.User).filter(models.User.id == db_req.user_id).first()
        if user:
            from email_service import send_db_approval_email
            send_db_approval_email(user.email, user.full_name, db_req.access_type)
            
            if db_req.access_type == "system":
                pkg = db.query(models.Package).filter(models.Package.name == "db_sync").first()
                if pkg:
                    existing_up = db.query(models.UserPackage).filter(
                        models.UserPackage.user_id == user.id,
                        models.UserPackage.package_id == pkg.id
                    ).first()
                    if existing_up:
                        existing_up.status = "active"
                    else:
                        new_up = models.UserPackage(user_id=user.id, package_id=pkg.id, status="active")
                        db.add(new_up)
                    db.commit()
    elif req.status == "rejected":
        if db_req.access_type == "system":
            user = db.query(models.User).filter(models.User.id == db_req.user_id).first()
            if user:
                pkg = db.query(models.Package).filter(models.Package.name == "db_sync").first()
                if pkg:
                    existing_up = db.query(models.UserPackage).filter(
                        models.UserPackage.user_id == user.id,
                        models.UserPackage.package_id == pkg.id
                    ).first()
                    if existing_up:
                        db.delete(existing_up)
                        db.commit()

    return {"id": db_req.id, "status": db_req.status}

@router.get("/inquiries")
def get_inquiries(admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    inqs = db.query(models.Inquiry).all()
    result = []
    for i in inqs:
        user = db.query(models.User).filter(models.User.id == i.user_id).first()
        result.append({
            "id": i.id,
            "user_name": user.full_name if user else "Unknown",
            "user_email": user.email if user else "Unknown",
            "subject": i.subject,
            "message": i.message,
            "status": i.status,
            "created_at": i.created_at
        })
    return result

@router.put("/inquiries/{inquiry_id}")
def update_inquiry_status(inquiry_id: int, req: schemas.UpdateInquiryStatusRequest, admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    inq = db.query(models.Inquiry).filter(models.Inquiry.id == inquiry_id).first()
    if not inq:
        raise HTTPException(status_code=404, detail="Inquiry not found")
        
    inq.status = req.status
    db.commit()
    return {"id": inq.id, "status": inq.status}

@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin users")
    
    # Delete related records
    db.query(models.UserPackage).filter(models.UserPackage.user_id == user_id).delete()
    db.query(models.UserFieldConfig).filter(models.UserFieldConfig.user_id == user_id).delete()
    db.query(models.Inquiry).filter(models.Inquiry.user_id == user_id).delete()
    db.query(models.Review).filter(models.Review.user_id == user_id).delete()
    db.query(models.ScrapeLog).filter(models.ScrapeLog.user_id == user_id).delete()
    db.query(models.User).filter(models.User.id == user_id).delete()
    db.commit()
    return {"message": "User deleted successfully"}

@router.get("/metrics")
def get_admin_metrics(admin_user: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    from sqlalchemy import func
    users = db.query(models.User).all()
    metrics = []
    for user in users:
        logs = db.query(models.ScrapeLog).filter(models.ScrapeLog.user_id == user.id).order_by(models.ScrapeLog.created_at.desc()).all()
        total_scrapes = len(logs)
        total_rows = sum(l.rows_scraped for l in logs)
        last_scrape = logs[0].created_at.isoformat() if logs else None
        
        # Get packages
        user_packages = db.query(models.UserPackage).filter(models.UserPackage.user_id == user.id).all()
        packages = []
        for up in user_packages:
            pkg = db.query(models.Package).filter(models.Package.id == up.package_id).first()
            if pkg:
                packages.append({"name": pkg.name, "display_name": pkg.display_name, "status": up.status})
        
        recent_logs = []
        for l in logs[:20]:
            recent_logs.append({
                "id": l.id,
                "rows_scraped": l.rows_scraped,
                "created_at": l.created_at.isoformat()
            })
        
        metrics.append({
            "user_id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role,
            "status": user.status,
            "email_verified": user.email_verified,
            "packages": packages,
            "total_scrapes": total_scrapes,
            "total_rows_scraped": total_rows,
            "last_scrape": last_scrape,
            "recent_logs": recent_logs
        })
    
    # Global stats
    total_users = db.query(models.User).count()
    active_users = db.query(models.User).filter(models.User.status == "active").count()
    total_scrape_logs = db.query(models.ScrapeLog).count()
    total_data_records = db.query(models.FleetData).count()
    
    return {
        "global_stats": {
            "total_users": total_users,
            "active_users": active_users,
            "total_scrape_logs": total_scrape_logs,
            "total_data_records": total_data_records
        },
        "user_metrics": metrics
    }
