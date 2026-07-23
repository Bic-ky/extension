from sqlalchemy import Column, Integer, String, Float, DateTime , UniqueConstraint
from db_connection import Base
import datetime

class FleetData(Base):
    __tablename__ = "yango_metrics"

    __table_args__ = (
        UniqueConstraint("trip_date", "driver_id", name="uq_trip_date_driver"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trip_date = Column(String, index=True)
    rider_name = Column(String)
    phone_number = Column(String)
    driver_id = Column(String, index=True)
    completed_rides = Column(Float, default=0)
    total_mileage = Column(Float, default=0)
    cash = Column(Float, default=0)
    promotion_compensation = Column(Float, default=0)
    bonus = Column(Float, default=0)
    partner_fees = Column(Float, default=0)
    total_collection = Column(Float, default=0)
    online_hours = Column(Float, default=0)
    average_hourly_earnings = Column(Float, default=0)
    achieved_goal = Column(Integer, default=0)
    target_goal = Column(Integer, default=0)
    subvention_bonus = Column(Float, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)