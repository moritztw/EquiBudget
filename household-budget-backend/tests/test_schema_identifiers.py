"""Automatisierte Prüfung aller SQL-Bezeichner auf das PostgreSQL-Limit (<= 63 Zeichen)."""
from __future__ import annotations

import ast
import unittest
from pathlib import Path

PG_MAX_IDENTIFIER_LEN = 63
BACKEND_ROOT = Path(__file__).resolve().parents[1]
VERSIONS_DIR = BACKEND_ROOT / "alembic" / "versions"


def _extrahiere_migrations_bezeichner(dateipfad: Path) -> list[tuple[int, str]]:
    """Liest Tabellen-, Spalten-, Index- und Constraint-Namen per AST aus einer Alembic-Datei."""
    baum = ast.parse(dateipfad.read_text(encoding="utf-8"), filename=str(dateipfad))
    gefundene: list[tuple[int, str]] = []

    for knoten in ast.walk(baum):
        if not isinstance(knoten, ast.Call):
            continue

        funktionsname = ""
        if isinstance(knoten.func, ast.Attribute):
            funktionsname = knoten.func.attr
        elif isinstance(knoten.func, ast.Name):
            funktionsname = knoten.func.id

        # Erstes Positionsargument bei create_table, create_index, Column
        if funktionsname in {"create_table", "create_index", "drop_table", "drop_index", "Column"}:
            if knoten.args and isinstance(knoten.args[0], ast.Constant) and isinstance(knoten.args[0].value, str):
                gefundene.append((knoten.args[0].lineno, knoten.args[0].value))

        # Explizite name="..." Keyword-Argumente bei Constraints / Indizes / ForeignKeys
        for kw in knoten.keywords:
            if kw.arg == "name" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                gefundene.append((kw.value.lineno, kw.value.value))

    return gefundene


class PostgresIdentifierLengthTests(unittest.TestCase):
    """Stellt sicher, dass kein Bezeichner das PostgreSQL-Limit von 63 Bytes überschreitet."""

    def test_alembic_migrationen_halten_63_zeichen_limit_ein(self) -> None:
        migrationsdateien = sorted(VERSIONS_DIR.glob("*.py"))
        self.assertTrue(migrationsdateien, "Keine Alembic-Migrationsdateien gefunden.")

        ueberschreitungen: list[str] = []
        gepruefte_anzahl = 0

        for datei in migrationsdateien:
            for zeile, name in _extrahiere_migrations_bezeichner(datei):
                gepruefte_anzahl += 1
                laenge = len(name.encode("utf-8"))
                if laenge > PG_MAX_IDENTIFIER_LEN:
                    ueberschreitungen.append(
                        f"{datei.name}:{zeile} -> '{name}' ({laenge} > {PG_MAX_IDENTIFIER_LEN} Bytes)"
                    )

        self.assertGreater(gepruefte_anzahl, 50)
        self.assertEqual(
            ueberschreitungen,
            [],
            "Folgende Alembic-Bezeichner überschreiten das PostgreSQL-Limit:\n"
            + "\n".join(ueberschreitungen),
        )

    def test_orm_metadata_haelt_63_zeichen_limit_ein_wenn_sqlalchemy_installiert(self) -> None:
        try:
            from sqlalchemy.dialects import postgresql
            from sqlalchemy.schema import CreateIndex, CreateTable

            from app.models import Base
        except ModuleNotFoundError:
            # In Umgebungen ohne installiertes SQLAlchemy greift der statische AST-Test unten.
            self._pruefe_orm_naming_statisch()
            return

        dialect = postgresql.dialect()
        for tabelle in Base.metadata.sorted_tables:
            self.assertLessEqual(len(tabelle.name.encode("utf-8")), PG_MAX_IDENTIFIER_LEN)
            # Kompiliert komplettes CREATE TABLE inkl. PK/FK/UQ/CK gegen PostgreSQL-Validator
            str(CreateTable(tabelle).compile(dialect=dialect))
            for index in tabelle.indexes:
                str(CreateIndex(index).compile(dialect=dialect))

    def _pruefe_orm_naming_statisch(self) -> None:
        entities_pfad = BACKEND_ROOT / "app" / "models" / "entities.py"
        baum = ast.parse(entities_pfad.read_text(encoding="utf-8"), filename=str(entities_pfad))

        for knoten in ast.walk(baum):
            if not isinstance(knoten, ast.ClassDef):
                continue

            tabellenname: str | None = None
            for element in knoten.body:
                if (
                    isinstance(element, ast.Assign)
                    and len(element.targets) == 1
                    and isinstance(element.targets[0], ast.Name)
                    and element.targets[0].id == "__tablename__"
                    and isinstance(element.value, ast.Constant)
                    and isinstance(element.value.value, str)
                ):
                    tabellenname = element.value.value

            if not tabellenname:
                continue

            self.assertLessEqual(len(f"pk_{tabellenname}"), PG_MAX_IDENTIFIER_LEN)

            for element in knoten.body:
                if (
                    isinstance(element, ast.AnnAssign)
                    and isinstance(element.target, ast.Name)
                    and isinstance(element.value, ast.Call)
                ):
                    spaltenname = element.target.id
                    for sub in ast.walk(element.value):
                        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name) and sub.func.id == "ForeignKey":
                            expliziter_name = next(
                                (
                                    kw.value.value
                                    for kw in sub.keywords
                                    if kw.arg == "name"
                                    and isinstance(kw.value, ast.Constant)
                                    and isinstance(kw.value.value, str)
                                ),
                                None,
                            )
                            if expliziter_name:
                                fk_name = expliziter_name
                            elif sub.args and isinstance(sub.args[0], ast.Constant) and isinstance(sub.args[0].value, str):
                                ziel_tabelle = sub.args[0].value.split(".")[0]
                                fk_name = f"fk_{tabellenname}_{spaltenname}_{ziel_tabelle}"
                            else:
                                continue
                            self.assertLessEqual(
                                len(fk_name),
                                PG_MAX_IDENTIFIER_LEN,
                                f"ForeignKey '{fk_name}' überschreitet 63 Zeichen.",
                            )

            for sub in ast.walk(knoten):
                if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name):
                    # Prüft CheckConstraint(..., name="...") mit Naming-Convention ck_<table>_<name>
                    if sub.func.id == "CheckConstraint":
                        for kw in sub.keywords:
                            if kw.arg == "name" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                                vollname = f"ck_{tabellenname}_{kw.value.value}"
                                self.assertLessEqual(
                                    len(vollname),
                                    PG_MAX_IDENTIFIER_LEN,
                                    f"CheckConstraint '{vollname}' überschreitet 63 Zeichen.",
                                )


if __name__ == "__main__":
    unittest.main()
