from db_connection import SessionLocal
import models
from main import seed_packages

# 1. Seed packages
seed_packages()

# 2. Assign to all users
db = SessionLocal()
scraping_pkg = db.query(models.Package).filter(models.Package.name == "data_scraping").first()
if scraping_pkg:
    users = db.query(models.User).all()
    for user in users:
        # Check if already has it
        has_pkg = db.query(models.UserPackage).filter(
            models.UserPackage.user_id == user.id,
            models.UserPackage.package_id == scraping_pkg.id
        ).first()
        
        if not has_pkg:
            up = models.UserPackage(user_id=user.id, package_id=scraping_pkg.id, status="active")
            db.add(up)
    db.commit()
    print("Assigned data_scraping to all users.")
else:
    print("Error: data_scraping package not found even after seeding.")
db.close()
