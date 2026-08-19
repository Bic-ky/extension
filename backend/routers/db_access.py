from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from db_connection import get_db
from models import DatabaseAccessRequest, User
from schemas import DBAccessRequestCreate, DBAccessRequestResponse
from auth_utils import get_current_user

router = APIRouter(prefix="/api/db-access", tags=["DB Access"])

@router.post("/request", response_model=DBAccessRequestResponse)
def create_db_access_request(
    payload: DBAccessRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # If they are requesting custom access, validate the URL
    if payload.access_type == "custom" and not payload.custom_db_url:
        raise HTTPException(status_code=400, detail="custom_db_url is required for custom access")
        
    # delete any pending requests for this user
    db.query(DatabaseAccessRequest).filter(
        DatabaseAccessRequest.user_id == current_user.id,
        DatabaseAccessRequest.status == "pending"
    ).delete(synchronize_session=False)
    
    new_request = DatabaseAccessRequest(
        user_id=current_user.id,
        access_type=payload.access_type,
        custom_db_url=payload.custom_db_url
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)
    
    return new_request

@router.get("/my-requests", response_model=List[DBAccessRequestResponse])
def get_my_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    requests = db.query(DatabaseAccessRequest).filter(
        DatabaseAccessRequest.user_id == current_user.id
    ).order_by(DatabaseAccessRequest.created_at.desc()).all()
    return requests
