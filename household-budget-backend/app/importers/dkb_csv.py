from __future__ import annotations

import csv
import io
import re
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from app.domain.money import ZERO, quantize_cents
from app.importers.base import (
    NormalizedStatementRow,
    StatementParseError,
    StatementParseResult,
    compute_statement_dedup_hash,
    normalize_iban,
)

IBAN_EXTRACTION_RE = re.compile(r"\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b")


def _decode_dkb_bytes(raw_bytes: bytes) -> str:
    """Decode DKB CSV exports (UTF-8 with/without BOM in new banking, CP1252/ISO-8859-1 in legacy)."""
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "iso-8859-1"):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise StatementParseError("Unable to decode CSV character encoding.")


def _parse_german_date(raw_value: str, *, line_number: int) -> date:
    """Parse DD.MM.YY or DD.MM.YYYY date strings exported by DKB."""
    cleaned = raw_value.strip()
    for fmt in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    raise StatementParseError(
        f"Invalid booking or value date '{cleaned}'. Expected DD.MM.YY or DD.MM.YYYY.",
        line_number=line_number,
    )


def _parse_german_decimal(raw_value: str, *, line_number: int) -> Decimal:
    """Parse German localized amounts such as '-1.234,56 €' or '2.450,00' into exact Decimal."""
    cleaned = (
        raw_value.replace("€", "")
        .replace("EUR", "")
        .replace("\xa0", "")
        .strip()
    )
    if not cleaned:
        raise StatementParseError("Empty monetary amount cell in DKB CSV.", line_number=line_number)

    if "," in cleaned and "." in cleaned:
        normalized = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        normalized = cleaned.replace(",", ".")
    else:
        normalized = cleaned

    try:
        return quantize_cents(Decimal(normalized))
    except InvalidOperation as exc:
        raise StatementParseError(
            f"Malformed monetary amount '{raw_value}'.",
            line_number=line_number,
        ) from exc


class DkbCsvStatementParser:
    """
    Production CSV parser for Deutsche Kreditbank (DKB) checking and joint accounts.
    Supports both:
    1. Modern DKB Banking CSV ('Buchungsdatum';'Wertstellung';'Status';'Zahlungspflichtige*r';
       'Zahlungsempfänger*in';'Verwendungszweck';'Umsatztyp';'IBAN';'Betrag (€)';...)
    2. Legacy DKB Girokonto CSV ('Buchungstag';'Wertstellung';'Buchungstext';
       'Auftraggeber / Begünstigter';'Verwendungszweck';'Kontonummer';'BLZ';'Betrag (EUR)';...)
    """

    @property
    def parser_key(self) -> str:
        return "dkb_csv"

    def can_parse(self, filename: str, raw_bytes: bytes) -> bool:
        if not filename.lower().endswith(".csv") and b";" not in raw_bytes[:2048]:
            return False
        sample_text = _decode_dkb_bytes(raw_bytes[:4096])
        return (
            '"Buchungsdatum";"Wertstellung"' in sample_text
            or "Buchungsdatum;Wertstellung" in sample_text
            or '"Buchungstag";"Wertstellung"' in sample_text
            or "Buchungstag;Wertstellung" in sample_text
        )

    def parse(
        self,
        raw_bytes: bytes,
        *,
        include_pending: bool = False,
    ) -> StatementParseResult:
        if not raw_bytes.strip():
            raise StatementParseError("Uploaded CSV file is empty.")

        decoded_text = _decode_dkb_bytes(raw_bytes)
        lines = decoded_text.splitlines()

        header_idx: int | None = None
        detected_account_iban: str | None = None

        for idx, line in enumerate(lines[:30]):
            compact_upper = line.replace(" ", "").upper()
            iban_match = IBAN_EXTRACTION_RE.search(compact_upper)
            if iban_match and detected_account_iban is None:
                detected_account_iban = iban_match.group(1)

            if ("BUCHUNGSDATUM" in line.upper() or "BUCHUNGSTAG" in line.upper()) and (
                "WERTSTELLUNG" in line.upper()
            ):
                header_idx = idx
                break

        if header_idx is None:
            raise StatementParseError(
                "Could not locate DKB CSV column header ('Buchungsdatum'/'Buchungstag' & 'Wertstellung')."
            )

        csv_body = "\n".join(lines[header_idx:])
        reader = csv.DictReader(io.StringIO(csv_body), delimiter=";", quotechar='"')
        if reader.fieldnames is None:
            raise StatementParseError("DKB CSV header row contains no columns.")

        headers = {h.strip(): h for h in reader.fieldnames if h is not None}
        is_modern_dkb = "Buchungsdatum" in headers

        parsed_rows: list[NormalizedStatementRow] = []
        skipped_count = 0
        occurrence_counter: Counter[str] = Counter()

        for offset, raw_row in enumerate(reader, start=1):
            source_line = header_idx + 1 + offset
            row = {(k.strip() if k else ""): (v.strip() if v else "") for k, v in raw_row.items()}

            if not any(row.values()):
                continue

            if is_modern_dkb:
                status_val = row.get("Status", "")
                if not include_pending and status_val and status_val.lower() != "gebucht":
                    skipped_count += 1
                    continue

                raw_booking = row.get("Buchungsdatum", "")
                if not raw_booking or raw_booking.lower() == "offen":
                    skipped_count += 1
                    continue

                booking_dt = _parse_german_date(raw_booking, line_number=source_line)
                raw_val_date = row.get("Wertstellung", "")
                value_dt = (
                    _parse_german_date(raw_val_date, line_number=source_line)
                    if raw_val_date
                    else None
                )

                amount_col = next(
                    (val for key, val in row.items() if key.startswith("Betrag")),
                    "",
                )
                amount = _parse_german_decimal(amount_col, line_number=source_line)
                if amount == ZERO:
                    skipped_count += 1
                    continue

                # In modern DKB CSV, payee vs payer depends on cashflow direction
                payer = row.get("Zahlungspflichtige*r", "")
                payee = row.get("Zahlungsempfänger*in", "")
                counterparty_name = payee if amount < ZERO else payer
                if not counterparty_name:
                    counterparty_name = payee or payer or None

                counterparty_iban = normalize_iban(row.get("IBAN"))
                purpose = row.get("Verwendungszweck", "")
            else:
                raw_booking = row.get("Buchungstag", "")
                if not raw_booking:
                    skipped_count += 1
                    continue

                booking_dt = _parse_german_date(raw_booking, line_number=source_line)
                raw_val_date = row.get("Wertstellung", "")
                value_dt = (
                    _parse_german_date(raw_val_date, line_number=source_line)
                    if raw_val_date
                    else None
                )
                amount_col = next(
                    (val for key, val in row.items() if key.startswith("Betrag")),
                    "",
                )
                amount = _parse_german_decimal(amount_col, line_number=source_line)
                if amount == ZERO:
                    skipped_count += 1
                    continue

                counterparty_name = row.get("Auftraggeber / Begünstigter") or None
                raw_acct_no = row.get("Kontonummer", "")
                counterparty_iban = (
                    normalize_iban(raw_acct_no)
                    if raw_acct_no and raw_acct_no[:2].isalpha()
                    else None
                )
                booking_text = row.get("Buchungstext", "")
                verwendungszweck = row.get("Verwendungszweck", "")
                purpose = " — ".join(part for part in (booking_text, verwendungszweck) if part)

            occurrence_signature = (
                f"{booking_dt.isoformat()}|{amount:.2f}|"
                f"{(counterparty_name or '').lower()}|{purpose.lower()}"
            )
            occurrence_counter[occurrence_signature] += 1
            occurrence_idx = occurrence_counter[occurrence_signature]

            dedup_hash = compute_statement_dedup_hash(
                booking_date=booking_dt,
                value_date=value_dt,
                amount=amount,
                currency="EUR",
                counterparty_name=counterparty_name,
                counterparty_iban=counterparty_iban,
                purpose_text=purpose,
                occurrence_index=occurrence_idx,
            )

            parsed_rows.append(
                NormalizedStatementRow(
                    row_number=len(parsed_rows) + 1,
                    booking_date=booking_dt,
                    value_date=value_dt,
                    amount=amount,
                    currency="EUR",
                    counterparty_name=counterparty_name,
                    counterparty_iban=counterparty_iban,
                    purpose_text=purpose,
                    import_dedup_hash=dedup_hash,
                )
            )

        return StatementParseResult(
            parser_key=self.parser_key,
            detected_account_iban=detected_account_iban,
            rows=tuple(parsed_rows),
            skipped_pending_or_zero_count=skipped_count,
        )
