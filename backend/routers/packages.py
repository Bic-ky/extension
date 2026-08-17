from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db_connection import get_db
import models, schemas
from auth_utils import get_current_user

router = APIRouter(prefix="/api/packages", tags=["Packages"])

@router.get("/my")
def get_my_packages(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    user_packages = db.query(models.UserPackage).filter(models.UserPackage.user_id == current_user.id).all()
    result = []
    for up in user_packages:
        pkg = db.query(models.Package).filter(models.Package.id == up.package_id).first()
        if pkg:
            result.append({
                "id": pkg.id,
                "name": pkg.name,
                "display_name": pkg.display_name,
                "description": pkg.description,
                "status": up.status,
                "requested_at": up.created_at
            })
    return result

@router.get("/available")
def get_available_packages(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(models.Package).all()

@router.post("/request")
def request_package(req: schemas.PackageRequestCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    pkg = db.query(models.Package).filter(models.Package.name == req.package_name).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Package not found")
        
    existing_up = db.query(models.UserPackage).filter(
        models.UserPackage.user_id == current_user.id,
        models.UserPackage.package_id == pkg.id
    ).first()
    
    if existing_up:
        raise HTTPException(status_code=400, detail="Package already requested or active")
        
    new_up = models.UserPackage(user_id=current_user.id, package_id=pkg.id, status="pending")
    db.add(new_up)
    db.commit()
    
    return {"message": "Package requested successfully"}
