from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, UniqueConstraint
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

    vehicle_plate_number = Column(String)
    vehicle_detail = Column(String)

    completed_rides = Column(Float, default=0)
    total_mileage = Column(Float, default=0)
    cash = Column(Float, default=0)
    promotion_compensation = Column(Float, default=0)
    bonus = Column(Float, default=0)
    partner_fees = Column(Float, default=0)

    taxes = Column(Float, default=0)

    total_collection = Column(Float, default=0)
    online_hours = Column(Float, default=0)
    average_hourly_earnings = Column(Float, default=0)
    achieved_goal = Column(Integer, default=0)
    target_goal = Column(Integer, default=0)
    subvention_bonus = Column(Float, default=0)

    total_gps_mileage = Column(Float, default=0)
    active_mileage = Column(Float, default=0)
    idle_mileage = Column(Float, default=0)
    offline_mileage = Column(Float, default=0)

    # Track which user uploaded this record
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")           # "admin" or "user"
    status = Column(String, default="active")       # "active" or "deactivated"
    email_verified = Column(Boolean, default=False)
    verification_token = Column(String, nullable=True)
    verification_token_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Package(Base):
    __tablename__ = "packages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)        # "data_scraping", "db_sync"
    display_name = Column(String, nullable=False)              # "Data Scraping", "DB Sync"
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class UserPackage(Base):
    __tablename__ = "user_packages"

    __table_args__ = (
        UniqueConstraint("user_id", "package_id", name="uq_user_package"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    package_id = Column(Integer, ForeignKey("packages.id"), nullable=False)
    status = Column(String, default="pending")  # "active", "pending", "declined"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class UserFieldConfig(Base):
    __tablename__ = "user_field_configs"

    __table_args__ = (
        UniqueConstraint("user_id", "field_name", name="uq_user_field"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    field_name = Column(String, nullable=False)   # e.g. "Vehicle_Plate_Number"
    enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Inquiry(Base):
    __tablename__ = "inquiries"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    subject = Column(String, nullable=False)
    message = Column(String, nullable=False)
    status = Column(String, default="open")  # "open", "resolved"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Review(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    rating = Column(Integer, nullable=False)     # 1-5
    comment = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class ScrapeLog(Base):
    __tablename__ = "scrape_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rows_scraped = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)