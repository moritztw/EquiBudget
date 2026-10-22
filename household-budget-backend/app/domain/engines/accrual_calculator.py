from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import Tuple

class Frequency(str, Enum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    BI_MONTHLY = "bi_monthly"
    QUARTERLY = "quarterly"
    SEMI_ANNUALLY = "semi_annually"
    ANNUALLY = "annually"

class AccrualCalculator:
    @staticmethod
    def calculate_monthly_provision(amount: Decimal, frequency: Frequency) -> Decimal:
        """Converts periodic expense frequencies into their exact monthly equivalent provision."""
        if frequency == Frequency.WEEKLY:
            return ((amount * Decimal("52")) / Decimal("12")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.MONTHLY:
            return amount
        elif frequency == Frequency.BI_MONTHLY:
            return (amount / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.QUARTERLY:
            return (amount / Decimal("3")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.SEMI_ANNUALLY:
            return (amount / Decimal("6")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        elif frequency == Frequency.ANNUALLY:
            return (amount / Decimal("12")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        raise ValueError(f"Unsupported frequency: {frequency}")

    @staticmethod
    def offset_bank_debit(current_virtual_balance: Decimal, actual_debit_amount: Decimal) -> Tuple[Decimal, bool]:
        """Offsets an incoming real-world bank debit against the virtual sinking fund balance."""
        remaining = current_virtual_balance - actual_debit_amount
        return (remaining.quantize(Decimal("0.01")), remaining >= Decimal("0.00"))
