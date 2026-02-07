from datetime import datetime, timezone
from typing import Generic, List, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class Meta(BaseModel):
    """Metadata included in every API response."""

    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    version: str = "0.1.0"


class SuccessResponse(BaseModel, Generic[T]):
    """Standard envelope for successful responses."""

    data: T
    meta: Meta = Field(default_factory=Meta)


class ErrorResponse(BaseModel):
    """Standard envelope for error responses."""

    detail: str
    error_code: str
    meta: Meta = Field(default_factory=Meta)


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard envelope for paginated list responses."""

    data: List[T]
    total: int
    page: int
    page_size: int
    meta: Meta = Field(default_factory=Meta)
