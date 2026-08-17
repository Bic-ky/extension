from db_connection import engine, Base
import models

# Drop all tables
Base.metadata.drop_all(bind=engine)

# Recreate all tables
Base.metadata.create_all(bind=engine)
print("Database tables recreated successfully.")
