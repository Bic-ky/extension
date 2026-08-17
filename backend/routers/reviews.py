from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db_connection import get_db
import models, schemas
from auth_utils import get_current_user

router = APIRouter(prefix="/api/reviews", tags=["Reviews"])

@router.post("/")
def create_review(req: schemas.ReviewCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not (1 <= req.rating <= 5):
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
        
    existing_review = db.query(models.Review).filter(models.Review.user_id == current_user.id).first()
    if existing_review:
        existing_review.rating = req.rating
        existing_review.comment = req.comment
        db.commit()
        db.refresh(existing_review)
        return existing_review
        
    new_review = models.Review(
        user_id=current_user.id,
        rating=req.rating,
        comment=req.comment
    )
    db.add(new_review)
    db.commit()
    db.refresh(new_review)
    return new_review

@router.get("/")
def get_reviews(db: Session = Depends(get_db)):
    reviews = db.query(models.Review).order_by(models.Review.created_at.desc()).all()
    result = []
    for r in reviews:
        user = db.query(models.User).filter(models.User.id == r.user_id).first()
        result.append({
            "id": r.id,
            "rating": r.rating,
            "comment": r.comment,
            "user_name": user.full_name if user else "Unknown",
            "created_at": r.created_at
        })
    return result

@router.get("/my")
def get_my_review(current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(models.Review).filter(models.Review.user_id == current_user.id).first()
