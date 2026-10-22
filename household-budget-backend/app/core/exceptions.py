from fastapi import Request, status
from fastapi.responses import JSONResponse
from typing import Optional, Dict, Any
from pydantic import BaseModel

class ErrorResponseDTO(BaseModel):
    error_code: str
    message: str
    details: Dict[str, Any] = {}

class AppException(Exception):
    def __init__(
        self,
        error_code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        status_code: int = status.HTTP_400_BAD_REQUEST
    ):
        self.error_code = error_code
        self.message = message
        self.details = details or {}
        self.status_code = status_code
        super().__init__(message)

class AccountNotFoundException(AppException):
    def __init__(self, account_id: str):
        super().__init__(
            error_code="ERR_ACCOUNT_NOT_FOUND",
            message=f"Account with ID {account_id} does not exist.",
            details={"account_id": account_id},
            status_code=status.HTTP_404_NOT_FOUND
        )

class InsufficientFundBalanceException(AppException):
    def __init__(self, fund_id: str, available: float, requested: float):
        super().__init__(
            error_code="ERR_INSUFFICIENT_FUNDS",
            message=f"Virtual fund {fund_id} has insufficient balance.",
            details={"fund_id": fund_id, "available": available, "requested": requested},
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY
        )

class InvalidImportFormatException(AppException):
    def __init__(self, reason: str):
        super().__init__(
            error_code="ERR_INVALID_IMPORT_FORMAT",
            message=f"Invalid bank statement format: {reason}",
            details={"reason": reason},
            status_code=status.HTTP_400_BAD_REQUEST
        )

class NoActiveEarnersException(AppException):
    def __init__(self):
        super().__init__(
            error_code="ERR_NO_ACTIVE_EARNERS",
            message="Household must contain at least one registered earner to calculate allocations.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY
        )

async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error_code": exc.error_code,
            "message": exc.message,
            "details": exc.details
        }
    )
