from pydantic import BaseModel
from typing import List

class DriverDataSchema(BaseModel):
    Trip_Date: str
    Rider_Name: str
    Phone_Number: str
    ID: str
    Completed_Rides: float
    Total_Mileage: float
    Cash: float
    Promotion_Compensation: float
    Bonus: float
    Partner_Fees: float
    Total_Collection: float
    Online_Hours: float
    Average_Hourly_Earnings: float
    Achieved_Goal: int
    Target_Goal: int
    Subvention_Bonus: float

class BulkDataPayload(BaseModel):
    data: List[DriverDataSchema]