from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict
import re
from datetime import datetime


# ── Existing Data Schemas ────────────────────────────────────────────────────

class DriverDataSchema(BaseModel):
    Trip_Date: str
    Rider_Name: str = Field(max_length=200)
    Phone_Number: str = Field(default="", max_length=50)
    ID: str = Field(default="", max_length=100)
    Vehicle_Plate_Number: str = ""
    Vehicle_Detail: str = ""
    Completed_Rides: float = 0
    Total_Mileage: float = 0
    Cash: float = 0
    Promotion_Compensation: float = 0
    Bonus: float = 0
    Partner_Fees: float = 0
    Taxes_And_Fees: float = 0
    Total_Collection: float = 0
    Online_Hours: float = 0
    Average_Hourly_Earnings: float = 0
    Achieved_Goal: int = 0
    Target_Goal: int = 0
    Subvention_Bonus: float = 0
    Total_GPS_Mileage: float = 0
    Active_Mileage: float = 0
    Idle_Mileage: float = 0
    Offline_Mileage: float = 0


class BulkDataPayload(BaseModel):
    data: List[DriverDataSchema]


# ── Auth Schemas ─────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ResendVerificationRequest(BaseModel):
    email: str = Field(max_length=255)


# ── Admin Schemas ────────────────────────────────────────────────────────────

class CreateUserRequest(BaseModel):
    full_name: str = Field(max_length=100)
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    package_names: List[str] = []

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if not re.search(r'[A-Z]', v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not re.search(r'[a-z]', v):
            raise ValueError('Password must contain at least one lowercase letter')
        if not re.search(r'[0-9]', v):
            raise ValueError('Password must contain at least one digit')
        return v


class UpdateUserStatusRequest(BaseModel):
    status: str    # "active" or "deactivated"


class AssignPackagesRequest(BaseModel):
    package_names: List[str]
    status: str = "active"


class UpdatePackageRequestStatus(BaseModel):
    status: str    # "active" or "declined"


class UpdateInquiryStatusRequest(BaseModel):
    status: str    # "open" or "resolved"


# ── Package Schemas ──────────────────────────────────────────────────────────

class PackageRequestCreate(BaseModel):
    package_name: str = Field(max_length=50)


# ── Field Config Schemas ─────────────────────────────────────────────────────

class FieldConfigUpdate(BaseModel):
    fields: Dict[str, bool]


# ── Inquiry Schemas ──────────────────────────────────────────────────────────

class InquiryCreate(BaseModel):
    subject: str = Field(max_length=200)
    message: str = Field(max_length=5000)


# ── Review Schemas ───────────────────────────────────────────────────────────

class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=2000)


# ── DB Access Request Schemas ────────────────────────────────────────────────

class DBAccessRequestCreate(BaseModel):
    access_type: str = Field(..., pattern="^(system|custom)$")
    custom_db_url: Optional[str] = None
    
class DBAccessRequestResponse(BaseModel):
    id: int
    access_type: str
    custom_db_url: Optional[str]
    status: str
    created_at: datetime