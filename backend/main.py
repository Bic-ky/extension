from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from db_connection import engine
import models
from routers import auth, admin, packages, fields, data, inquiry, reviews, db_access
import logging

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    limiter = Limiter(key_func=get_remote_address)
    HAS_LIMITER = True
except ImportError:
    HAS_LIMITER = False

logger = logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    models.Base.metadata.create_all(bind=engine)
    seed_packages()
    yield
    # Shutdown

def seed_packages():
    from db_connection import SessionLocal
    db = SessionLocal()
    try:
        default_packages = [
            {"name": "data_scraping", "display_name": "Data Scraping", "description": "Scrape contractor earnings and metrics from Yango Fleet"},
            {"name": "db_sync", "display_name": "DB Sync", "description": "Sync scraped data to database and access via API"},
        ]
        for pkg_data in default_packages:
            existing = db.query(models.Package).filter(models.Package.name == pkg_data["name"]).first()
            if not existing:
                db.add(models.Package(**pkg_data))
        db.commit()
        logger.info("Default packages seeded.")
    except Exception as e:
        db.rollback()
        logger.error(f"Package seeding failed: {e}")
    finally:
        db.close()

app = FastAPI(title="Yango Fleet Exporter API", lifespan=lifespan)

if HAS_LIMITER:
    app.state.limiter = limiter
    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse(status_code=429, content={"detail": "Too many requests. Please try again later."})

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(packages.router)
app.include_router(fields.router)
app.include_router(data.router)
app.include_router(inquiry.router)
app.include_router(reviews.router)
app.include_router(db_access.router)

@app.get("/health")
def health_check():
    return {"status": "ok"}
