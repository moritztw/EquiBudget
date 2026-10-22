import re
from typing import List, Optional
from decimal import Decimal
from pydantic import BaseModel

class MatchResult(BaseModel):
    transaction_id: str
    status: str # 'matched_budget' | 'offset_sinking_fund' | 'unmatched'
    matched_budget_id: Optional[str] = None
    matched_sinking_fund_id: Optional[str] = None
    confidence: float
    explanation: str

class RuleBasedMatcher:
    @staticmethod
    def match(tx, rules: list) -> Optional[MatchResult]:
        for rule in rules:
            if rule.get("pattern_type") == "iban_exact" and tx.get("iban") == rule.get("match_pattern"):
                return MatchResult(
                    transaction_id=tx["id"],
                    status="matched_budget",
                    matched_budget_id=rule.get("target_budget_id"),
                    confidence=1.0,
                    explanation=f"Exact IBAN rule matched: {rule.get('name')}"
                )
            elif rule.get("pattern_type") == "payee_regex" and re.search(rule.get("match_pattern", ""), tx.get("payee", ""), re.IGNORECASE):
                return MatchResult(
                    transaction_id=tx["id"],
                    status="matched_budget",
                    matched_budget_id=rule.get("target_budget_id"),
                    confidence=0.95,
                    explanation=f"Regex pattern matched: {rule.get('name')}"
                )
        return None
