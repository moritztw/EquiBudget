from __future__ import annotations

import uuid
from collections.abc import Mapping
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP

from app.domain.exceptions import DomainValidationError

ZERO = Decimal("0.00")
ONE_CENT = Decimal("0.01")
FOUR_DECIMALS = Decimal("0.0001")
HUNDRED = Decimal("100")


def quantize_cents(amount: Decimal) -> Decimal:
    """Round a Decimal monetary value to 2 decimal places using commercial ROUND_HALF_UP."""
    return amount.quantize(ONE_CENT, rounding=ROUND_HALF_UP)


def quantize_ratio(ratio: Decimal) -> Decimal:
    """Round a share ratio to 4 decimal places (e.g. 0.3333 -> 33.33%)."""
    return ratio.quantize(FOUR_DECIMALS, rounding=ROUND_HALF_UP)


def distribute_cents_by_weights(
    total_amount: Decimal,
    weights: Mapping[uuid.UUID, Decimal],
) -> dict[uuid.UUID, Decimal]:
    """
    Allocate `total_amount` across keys proportionally to `weights` using the
    Largest-Remainder Method (Hamilton / Hare-Niemeyer) on integer cents.

    Guarantees `sum(result.values()) == quantize_cents(total_amount)` with zero cent drift.
    """
    normalized_total = quantize_cents(total_amount)
    if not weights:
        raise DomainValidationError("Cannot distribute amount across an empty weight mapping.")

    for person_id, weight in weights.items():
        if weight < ZERO:
            raise DomainValidationError(
                "Allocation weights must be non-negative.",
                details={"person_id": str(person_id), "weight": str(weight)},
            )

    weight_sum = sum(weights.values(), start=ZERO)
    if weight_sum <= ZERO:
        raise DomainValidationError(
            "Sum of allocation weights must be strictly positive.",
            details={"weight_sum": str(weight_sum)},
        )

    if normalized_total == ZERO:
        return {person_id: ZERO for person_id in weights}

    sign = -1 if normalized_total < ZERO else 1
    abs_total_cents = int((abs(normalized_total) * HUNDRED).to_integral_value(rounding=ROUND_HALF_UP))

    floor_cents_by_id: dict[uuid.UUID, int] = {}
    remainders: list[tuple[Decimal, Decimal, str, uuid.UUID]] = []

    for person_id, weight in weights.items():
        exact_cents = (Decimal(abs_total_cents) * weight) / weight_sum
        floored = int(exact_cents.to_integral_value(rounding=ROUND_FLOOR))
        fractional_remainder = exact_cents - Decimal(floored)
        floor_cents_by_id[person_id] = floored
        # Tie-breaking order: largest fractional remainder -> largest weight -> lexical UUID
        remainders.append((fractional_remainder, weight, str(person_id), person_id))

    allocated_cents = sum(floor_cents_by_id.values())
    leftover_cents = abs_total_cents - allocated_cents

    remainders.sort(key=lambda item: (-item[0], -item[1], item[2]))
    for idx in range(leftover_cents):
        winner_id = remainders[idx][3]
        floor_cents_by_id[winner_id] += 1

    return {
        person_id: quantize_cents((Decimal(cents * sign)) / HUNDRED)
        for person_id, cents in floor_cents_by_id.items()
    }
