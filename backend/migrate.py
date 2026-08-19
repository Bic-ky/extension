from db_connection import engine, Base
import models

def run_migration():
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully. Any missing tables (like db_access_requests) have been added.")

if __name__ == "__main__":
    run_migration()
