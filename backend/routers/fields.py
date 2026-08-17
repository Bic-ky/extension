from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db_connection import get_db
import models, schemas
from auth_utils import get_current_user, require_package

router = APIRouter(prefix="/api/fields", tags=["Fields"])

REQUIRED_FIELDS = [
    "Trip_Date", "Rider_Name", "Phone_Number", "ID",
    "Completed_Rides", "Total_Mileage", "Cash", "Bonus",
    "Partner_Fees", "Taxes_And_Fees", "Total_Collection",
    "Online_Hours", "Average_Hourly_Earnings", "Achieved_Goal", "Target_Goal"
]

@router.get("/config")
def get_fields_config(current_user: models.User = Depends(get_current_user), has_pkg = Depends(require_package("data_scraping")), db: Session = Depends(get_db)):
    field_configs = db.query(models.UserFieldConfig).filter(models.UserFieldConfig.user_id == current_user.id).all()
    optional_fields_dict = {fc.field_name: fc.enabled for fc in field_configs}
    
    return {
        "required_fields": REQUIRED_FIELDS,
        "optional_fields": optional_fields_dict
    }

@router.put("/config")
def update_fields_config(req: schemas.FieldConfigUpdate, current_user: models.User = Depends(get_current_user), has_pkg = Depends(require_package("data_scraping")), db: Session = Depends(get_db)):
    for field_name, enabled in req.fields.items():
        fc = db.query(models.UserFieldConfig).filter(
            models.UserFieldConfig.user_id == current_user.id,
            models.UserFieldConfig.field_name == field_name
        ).first()
        
        if fc:
            fc.enabled = enabled
        else:
            new_fc = models.UserFieldConfig(user_id=current_user.id, field_name=field_name, enabled=enabled)
            db.add(new_fc)
            
    db.commit()
    
    updated_configs = db.query(models.UserFieldConfig).filter(models.UserFieldConfig.user_id == current_user.id).all()
    updated_dict = {fc.field_name: fc.enabled for fc in updated_configs}
    return {
        "required_fields": REQUIRED_FIELDS,
        "optional_fields": updated_dict
    }
