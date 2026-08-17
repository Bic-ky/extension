from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db_connection import get_db
import models, schemas
from auth_utils import get_current_user

router = APIRouter(prefix="/api/inquiries", tags=["Inquiries"])

@router.post("/")
def create_inquiry(req: schemas.InquiryCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    new_inq = models.Inquiry(
        user_id=current_user.id,
        subject=req.subject,
        message=req.message,
        status="pending"
    )
    db.add(new_inq)
    db.commit()
    db.refresh(new_inq)
    return new_inq

@router.get("/my")
def get_my_inquiries(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(models.Inquiry).filter(models.Inquiry.user_id == current_user.id).order_by(models.Inquiry.created_at.desc()).all()
