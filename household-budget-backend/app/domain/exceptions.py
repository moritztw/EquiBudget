from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Base exception for all deterministic EquiBudget business rule violations."""

    def __init__(
        self,
        message: str,
        *,
        error_code: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details: dict[str, Any] = details if details is not None else {}


class DomainValidationError(DomainError):
    """Raised when input values violate financial invariants."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message,
            error_code="DOMAIN_VALIDATION_ERROR",
            details=details,
        )


class NoEligibleParticipantsError(DomainError):
    """Raised when an allocation cannot run because zero household persons qualify."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message,
            error_code="NO_ELIGIBLE_PARTICIPANTS",
            details=details,
        )


class InsufficientHouseholdIncomeError(DomainError):
    """Raised when shared obligations exceed the combined disposable household income."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message,
            error_code="INSUFFICIENT_HOUSEHOLD_INCOME",
            details=details,
        )


class InvalidAllocationWeightsError(DomainError):
    """Raised when custom split weights are missing, negative, or do not sum to 1.0."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message,
            error_code="INVALID_ALLOCATION_WEIGHTS",
            details=details,
        )


class InvalidAccrualScheduleError(DomainError):
    """Raised when sinking fund target amounts or dates are invalid."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(
            message,
            error_code="INVALID_ACCRUAL_SCHEDULE",
            details=details,
        )
