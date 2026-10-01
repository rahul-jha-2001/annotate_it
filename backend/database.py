from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import DATABASE_URL

# Normalize generic postgresql:// to postgresql+psycopg2:// for SQLAlchemy 2.0+ compatibility
SQLALCHEMY_DATABASE_URL = DATABASE_URL
if SQLALCHEMY_DATABASE_URL.startswith("postgresql://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

repeatable_read_engine = engine.execution_options(isolation_level="REPEATABLE READ")
RepeatableReadSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=repeatable_read_engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_repeatable_read_db():
    db = RepeatableReadSessionLocal()
    try:
        yield db
    finally:
        db.close()
