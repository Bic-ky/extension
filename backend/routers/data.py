from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import insert as pg_insert
from typing import Optional

from db_connection import get_db
import models, schemas
from auth_utils import get_current_user, require_package
import datetime

router = APIRouter(prefix="/api", tags=["Data"])

@router.post("/upload")
def upload_data(payload: schemas.BulkDataPayload, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    req = db.query(models.DatabaseAccessRequest).filter(
        models.DatabaseAccessRequest.user_id == current_user.id,
        models.DatabaseAccessRequest.access_type == "system",
        models.DatabaseAccessRequest.status == "approved"
    ).order_by(models.DatabaseAccessRequest.created_at.desc()).first()
    
    if not req:
        raise HTTPException(status_code=403, detail="System database access not approved")

    records = []
    for entry in payload.data:
        driver_dict = entry.dict(exclude_none=True)
        model_record = {
            "trip_date": driver_dict.get("Trip_Date"),
            "rider_name": driver_dict.get("Rider_Name"),
            "phone_number": driver_dict.get("Phone_Number"),
            "driver_id": driver_dict.get("ID"),
            "vehicle_plate_number": driver_dict.get("Vehicle_Plate_Number"),
            "vehicle_detail": driver_dict.get("Vehicle_Detail"),
            "completed_rides": driver_dict.get("Completed_Rides"),
            "total_mileage": driver_dict.get("Total_Mileage"),
            "cash": driver_dict.get("Cash"),
            "promotion_compensation": driver_dict.get("Promotion_Compensation"),
            "bonus": driver_dict.get("Bonus"),
            "partner_fees": driver_dict.get("Partner_Fees"),
            "taxes": driver_dict.get("Taxes_And_Fees"),
            "total_collection": driver_dict.get("Total_Collection"),
            "online_hours": driver_dict.get("Online_Hours"),
            "average_hourly_earnings": driver_dict.get("Average_Hourly_Earnings"),
            "achieved_goal": driver_dict.get("Achieved_Goal"),
            "target_goal": driver_dict.get("Target_Goal"),
            "subvention_bonus": driver_dict.get("Subvention_Bonus"),
            "total_gps_mileage": driver_dict.get("Total_GPS_Mileage"),
            "active_mileage": driver_dict.get("Active_Mileage"),
            "idle_mileage": driver_dict.get("Idle_Mileage"),
            "offline_mileage": driver_dict.get("Offline_Mileage"),
            "uploaded_by": current_user.id,
            "created_at": datetime.datetime.utcnow()
        }
        records.append(model_record)
        
    if not records:
        return {"message": "No data to insert", "inserted_count": 0}
        
    # Upsert to Central DB
    stmt = pg_insert(models.FleetData).values(records)
    update_dict = {c.name: c for c in stmt.excluded if c.name != "id"}
    upsert_stmt = stmt.on_conflict_do_update(
        index_elements=["trip_date", "driver_id"], 
        set_=update_dict
    )
    try:
        db.execute(upsert_stmt)
        db.commit()
    except Exception as e:
        db.rollback()
        for rec in records:
            existing = db.query(models.FleetData).filter(
                models.FleetData.trip_date == rec["trip_date"],
                models.FleetData.driver_id == rec["driver_id"]
            ).first()
            if existing:
                for k, v in rec.items():
                    setattr(existing, k, v)
            else:
                db.add(models.FleetData(**rec))
        db.commit()
    
    # Log the scrape activity
    scrape_log = models.ScrapeLog(user_id=current_user.id, rows_scraped=len(records))
    db.add(scrape_log)
    db.commit()
    
    return {"message": "Data processed successfully", "inserted_count": len(records)}

@router.post("/upload-custom")
def upload_data_custom(payload: schemas.BulkDataPayload, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    req = db.query(models.DatabaseAccessRequest).filter(
        models.DatabaseAccessRequest.user_id == current_user.id,
        models.DatabaseAccessRequest.access_type == "custom",
        models.DatabaseAccessRequest.status == "approved"
    ).order_by(models.DatabaseAccessRequest.created_at.desc()).first()
    
    if not req or not req.custom_db_url:
        raise HTTPException(status_code=403, detail="Custom database access not approved or URL missing")
        
    records = []
    for entry in payload.data:
        driver_dict = entry.dict(exclude_none=True)
        model_record = {
            "trip_date": driver_dict.get("Trip_Date"),
            "rider_name": driver_dict.get("Rider_Name"),
            "phone_number": driver_dict.get("Phone_Number"),
            "driver_id": driver_dict.get("ID"),
            "vehicle_plate_number": driver_dict.get("Vehicle_Plate_Number"),
            "vehicle_detail": driver_dict.get("Vehicle_Detail"),
            "completed_rides": driver_dict.get("Completed_Rides"),
            "total_mileage": driver_dict.get("Total_Mileage"),
            "cash": driver_dict.get("Cash"),
            "promotion_compensation": driver_dict.get("Promotion_Compensation"),
            "bonus": driver_dict.get("Bonus"),
            "partner_fees": driver_dict.get("Partner_Fees"),
            "taxes": driver_dict.get("Taxes_And_Fees"),
            "total_collection": driver_dict.get("Total_Collection"),
            "online_hours": driver_dict.get("Online_Hours"),
            "average_hourly_earnings": driver_dict.get("Average_Hourly_Earnings"),
            "achieved_goal": driver_dict.get("Achieved_Goal"),
            "target_goal": driver_dict.get("Target_Goal"),
            "subvention_bonus": driver_dict.get("Subvention_Bonus"),
            "total_gps_mileage": driver_dict.get("Total_GPS_Mileage"),
            "active_mileage": driver_dict.get("Active_Mileage"),
            "idle_mileage": driver_dict.get("Idle_Mileage"),
            "offline_mileage": driver_dict.get("Offline_Mileage"),
            "uploaded_by": current_user.id,
            "created_at": datetime.datetime.utcnow()
        }
        records.append(model_record)
        
    if not records:
        return {"message": "No data to insert", "inserted_count": 0}
        
    try:
        custom_engine = create_engine(req.custom_db_url, connect_args={"connect_timeout": 5})
        CustomSession = sessionmaker(bind=custom_engine)
        with CustomSession() as custom_db:
            stmt = pg_insert(models.FleetData).values(records)
            update_dict = {c.name: c for c in stmt.excluded if c.name != "id"}
            upsert_stmt = stmt.on_conflict_do_update(
                index_elements=["trip_date", "driver_id"], 
                set_=update_dict
            )
            try:
                custom_db.execute(upsert_stmt)
                custom_db.commit()
            except Exception as inner_e:
                custom_db.rollback()
                for rec in records:
                    existing = custom_db.query(models.FleetData).filter(
                        models.FleetData.trip_date == rec["trip_date"],
                        models.FleetData.driver_id == rec["driver_id"]
                    ).first()
                    if existing:
                        for k, v in rec.items():
                            setattr(existing, k, v)
                    else:
                        custom_db.add(models.FleetData(**rec))
                custom_db.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to connect or insert into custom database: {str(e)}")
        
    # Log scrape activity in central DB
    scrape_log = models.ScrapeLog(user_id=current_user.id, rows_scraped=len(records))
    db.add(scrape_log)
    db.commit()
    
    return {"message": "Data processed successfully in custom DB", "inserted_count": len(records)}

@router.get("/data")
def get_data(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    driver_id: Optional[str] = None,
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    current_user: models.User = Depends(get_current_user),
    has_pkg = Depends(require_package("db_sync")),
    db: Session = Depends(get_db)
):
    query = db.query(models.FleetData)
    
    if driver_id:
        query = query.filter(models.FleetData.driver_id == driver_id)
    if start_date:
        query = query.filter(models.FleetData.trip_date >= start_date)
    if end_date:
        query = query.filter(models.FleetData.trip_date <= end_date)
        
    results = query.offset(offset).limit(limit).all()
    return results

@router.get("/data/stats")
def get_data_stats(
    current_user: models.User = Depends(get_current_user),
    has_pkg = Depends(require_package("db_sync")),
    db: Session = Depends(get_db)
):
    total_records = db.query(models.FleetData).count()
    total_drivers = db.query(models.FleetData.driver_id).distinct().count()
    
    min_date = db.query(models.FleetData.trip_date).order_by(models.FleetData.trip_date.asc()).first()
    max_date = db.query(models.FleetData.trip_date).order_by(models.FleetData.trip_date.desc()).first()
    
    date_range = {
        "start": min_date[0] if min_date else None,
        "end": max_date[0] if max_date else None
    }
    
    return {
        "total_records": total_records,
        "total_drivers": total_drivers,
        "date_range": date_range
    }
