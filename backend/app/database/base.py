from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models.
    
    Provides the foundational structure for database models using SQLAlchemy 2.x's
    DeclarativeBase. All application models should inherit from this class to ensure:
    - Consistent model definition syntax
    - Type annotation support
    - Integration with SQLAlchemy's ORM features

    Note:
        This class contains no business logic - it exists purely as a base for ORM models.
    """

    pass  # Base class with no additional methods to keep it minimal

# Export the Base class to be inherited by models
Base = Base