"""
Seed script to create the initial admin user.
Usage: python seed_admin.py --email admin@example.com --password admin123 --name "Admin User"
"""
import argparse
import bcrypt
from db_connection import SessionLocal, engine
import models

models.Base.metadata.create_all(bind=engine)

def main():
    parser = argparse.ArgumentParser(description="Create an admin user")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.email == args.email).first()
        if existing:
            print(f"User with email {args.email} already exists.")
            if existing.role != "admin":
                existing.role = "admin"
                existing.email_verified = True
                existing.status = "active"
                db.commit()
                print(f"Updated existing user to admin role.")
            return

        hashed = bcrypt.hashpw(args.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        user = models.User(
            full_name=args.name,
            email=args.email,
            password_hash=hashed,
            role="admin",
            status="active",
            email_verified=True,
        )
        db.add(user)
        db.commit()
        print(f"Admin user created: {args.email}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
