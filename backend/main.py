from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import models
import schemas
from db_connection import engine, get_db
from sqlalchemy.dialects.postgresql import insert as pg_insert
import logging
import traceback
logger = logging.getLogger("uvicorn.error")
# Auto-create the table in PostgreSQL if it doesn't exist yet
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Yango Fleet Exporter API")

# Allow the Chrome Extension to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", "chrome-extension://*"], # Allows your extension to push data
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.post("/api/upload", status_code=status.HTTP_201_CREATED)
def receive_pipeline_data(payload: schemas.BulkDataPayload, db: Session = Depends(get_db)):
    try:
        rows = [
            {
                "trip_date": item.Trip_Date,
                "rider_name": item.Rider_Name,
                "phone_number": item.Phone_Number,
                "driver_id": item.ID,
                "completed_rides": item.Completed_Rides,
                "total_mileage": item.Total_Mileage,
                "cash": item.Cash,
                "promotion_compensation": item.Promotion_Compensation,
                "bonus": item.Bonus,
                "partner_fees": item.Partner_Fees,
                "total_collection": item.Total_Collection,
                "online_hours": item.Online_Hours,
                "average_hourly_earnings": item.Average_Hourly_Earnings,
                "achieved_goal": item.Achieved_Goal,
                "target_goal": item.Target_Goal,
                "subvention_bonus": item.Subvention_Bonus,
            }
            for item in payload.data
        ]

        stmt = pg_insert(models.FleetData).values(rows)
        update_cols = {c: stmt.excluded[c] for c in rows[0] if c not in ("trip_date", "driver_id")}

        stmt = stmt.on_conflict_do_update(
            constraint="uq_trip_date_driver",
            set_=update_cols,
        )

        db.execute(stmt)
        db.commit()

        return {
            "status": "success",
            "message": f"Upserted {len(rows)} records.",
        }

    except Exception as e:
        db.rollback()
        logger.error("Upload failed: %s", e)
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Database insertion failed: {str(e)}")
