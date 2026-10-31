# EquiBudget — Self-Hosted Multi-Tenant Haushalts-ERP & Sinking-Fund-Planer

**EquiBudget** ist eine selbst gehostete, mandantenfähige Finanz- und Liquiditätsplanungsplattform für Paar-, Familien- und Mehrpersonenhaushalte. Sie verbindet die **Informationsdichte einer Excel-Liquiditätsmatrix** mit der buchhalterischen Präzision eines **Domain-Driven-Design-ERPs** (exakte Cent-/Decimal-Arithmetik, Rückstellungsbuchhaltung über virtuelle Anspartöpfe, faire Einkommensaufteilung und automatisierter DKB-CSV-Abgleich).

---

## Inhaltsverzeichnis

1. [Warum EquiBudget?](#warum-equibudget)
2. [Kernfunktionen im Detail](#kernfunktionen-im-detail)
3. [Domänenmodell & Buchhaltungsprinzipien](#domänenmodell--buchhaltungsprinzipien)
4. [Systemarchitektur & Tech-Stack](#systemarchitektur--tech-stack)
5. [Schnellstart mit Docker Compose](#schnellstart-mit-docker-compose)
6. [Ersteinrichtung ohne Testdaten (Setup-Assistent)](#ersteinrichtung-ohne-testdaten-setup-assistent)
7. [Reverse Proxy & Pangolin / Newt (Forward-Auth)](#reverse-proxy--pangolin--newt-forward-auth)
8. [Lokale Entwicklung](#lokale-entwicklung)
9. [REST-API-Übersicht](#rest-api-übersicht)
10. [Projektstruktur](#projektstruktur)

---

## Warum EquiBudget?

Klassische Haushaltsbuch-Apps scheitern im Alltag oft an vier realen Anforderungen:

1. **Unregelmäßige Großrechnungen verzerren den Monat:** Jährliche Versicherungen, KFZ-Inspektionen, Rundfunkbeiträge oder der Sommerurlaub reißen Löcher ins Gemeinschaftskonto, wenn sie nicht monatlich geglättet zurückgestellt werden (*Sinking Funds*).
2. **Schwankende Monatsgehälter:** Rufbereitschaften, Quartalsboni, Überstundenauszahlungen, Urlaubsgeld oder Elterngeld ändern das verfügbare Netto jeden Monat. Statische Daueraufträge bilden das nicht fair ab.
3. **Verwechslung von physischen Konten und virtuellen Töpfen:** Eine Überweisung vom eigenen Girokonto aufs Tagesgeld ist ein *physischer Kontotransfer* — eine Umschichtung vom Urlaubs-Topf in den KFZ-Reparatur-Topf ist dagegen eine *rein virtuelle Umbuchung* ohne Banktransaktion.
4. **Fehlende Informationsdichte:** Wer seine Finanzen bisher in Excel geplant hat, will 12 Monate im Voraus auf einen Blick sehen, wann Zahlungsspitzen auftreten, wann Verträge enden und wann Preisstaffeln greifen.

EquiBudget löst genau diese Anforderungen in einer kompakten, installierbaren **Progressive Web App (PWA)** mit **Python/FastAPI- & PostgreSQL-Backend**.

---

## Kernfunktionen im Detail

### 1. Zahlungsplan & 12-Monats-Liquiditätsmatrix (ERP-Ansicht)
- **Excel-Dichte im Browser:** Tabellarische 12-Monats-Vorschau aller geplanten Zahlungen mit Gegenüberstellung von **realem Kontoabfluss (Cash-Out)**, **geglätteter Monatsumlage** und **monatlicher Über-/Unterdeckung**.
- **Direkte Inline-Editierung & Komplett-Dialog:** Beträge, Fälligkeiten und Enddaten lassen sich direkt in der Zeile ändern; für komplexe Anpassungen steht der Detail-Dialog bereit.
- **Geplante Betragsänderungen (`Gültig-ab`-Preisstaffeln):** Künftige Mieterhöhungen oder Beitragsanpassungen werden mit Stichtag hinterlegt und ab diesem Monat automatisch in Ansparrate und Cashflow-Vorschau eingerechnet, ohne historische Monate zu überschreiben.
- **Vertrags-Enddatum & Archiv-Filter:** Erreicht eine Zahlung (z. B. Kita-Gebühr oder gekündigtes Abo) ihre letzte Fälligkeit vor dem `Enddatum`, stoppt die monatliche Ansparrate sofort auf `0,00 €`. Eventuelles Restguthaben bleibt transparent im virtuellen Topf erhalten und kann per 1-Klick umgebucht werden.

### 2. Physische Bankkonten vs. Virtuelle Anspartöpfe (*Sinking Funds*)
- **Liquiditäts-Abstimmung in Echtzeit:** Für jedes physische Bankkonto prüft EquiBudget fortlaufend:
  $$\text{Frei verfügbare Liquidität} = \text{Realer Kontostand} - \text{Gebundene Rückstellungen (+)}$$
- **Startguthaben (`INITIAL_CARRYOVER`):** Bereits angesparte Rücklagen können beim Anlegen eines Topfes oder im Setup-Assistenten als Eröffnungsbestand eingebucht werden und reduzieren sofort die verbleibende Monatsrate.
- **Zahlungen auch aus ungedeckten Töpfen (Topf-Überziehung):** Fällt eine Rechnung höher oder früher aus als angespart (z. B. ungeplante KFZ-Reparatur über `520,00 €` bei `400,00 €` Topf-Stand), lässt sich die Zahlung dennoch vollständig aus dem Topf buchen. Der Topf geht transparent ins Minus (`-120,00 €`) und kann über künftige Aufholraten oder eine virtuelle Umbuchung ausgeglichen werden.
- **Virtuelle Topf-Umbuchung (`VIRTUAL_POT_REALLOCATION`):** Schichtet Rücklagen buchhalterisch zwischen zwei Töpfen um (gepaarte Soll-/Haben-Buchung über `reallocation_group_id`), ohne eine Banktransaktion zu erzeugen.

### 3. Monatsscharfe Einkommens-Erfassung & Faire Aufteilung
- **Monatliche Neuerfassung des realen Nettos:** In der Mehr-Monats-Einkommensmatrix trägt jede erwerbstätige Person pro Monat (`YYYY-MM`) ihr tatsächliches Nettoeinkommen inklusive variabler Bestandteile (Bonus, Schichtzulagen, Rufbereitschaft) neu ein.
- **Vier mathematisch exakte Aufteilungsmodelle (Hare-Niemeyer / Largest-Remainder auf Cent-Basis):**
  - **Gleiches Taschengeld (`EQUAL_REMAINING`):** Verteilt die gemeinsamen Fixkosten und Ansparraten so unter den Erwerbstätigen, dass allen exakt derselbe freie Betrag übrig bleibt (wahlweise mit Waterfilling-Kappung bei `0,00 €` oder striktem Ausgleichstransfer).
  - **Proportional (`PROPORTIONAL`):** Aufteilung exakt im Verhältnis des verfügbaren Nettoeinkommens.
  - **50 / 50 nach Köpfen (`FIFTY_FIFTY`):** Gleichmäßige Teilung unabhängig von der Gehaltshöhe.
  - **Feste Quote (`CUSTOM_WEIGHT`):** Frei definierbare prozentuale Gewichtung (z. B. `60 % / 40 %`).
- **Stammdaten getrennt von Logins:** Haushaltsmitglieder (`Person`) existieren unabhängig von Systembenutzern (`User`), sodass auch Kinder oder Personen ohne eigenen Login sauber abgebildet werden.

### 4. Buchungsjournal (*Ist-Zahlungen*) & DKB-CSV-Import
- **Vollständiges Journal aller Ist-Zahlungen:** Filterbare ERP-Übersicht über sämtliche importierten und manuell erfassten Kontobewegungen inklusive Inline-Nachkategorisierung, nachträglicher Topf-Zuordnung (1:1-Synchronisation mit `SinkingFundLedgerEntry`) und manueller Schnellerfassung.
- **DKB-CSV-Parser (Modern & Legacy):** Unterstützt sowohl das aktuelle DKB-Banking-Exportformat als auch ältere DKB-Girokonto-CSVs (inkl. automatischer Filterung vorgemerkter Umsätze). Erweiterbar über `StatementParserInterface`.
- **Zweistufiger Duplikat-Schutz gegen Doppelbuchungen:**
  1. **`EXACT_HASH` (SHA-256):** Erkennt identische CSV-Zeilen bei überlappenden Kontoauszugs-Exporten und sperrt sie zuverlässig.
  2. **`SEMANTIC_MATCH` (±4 Kalendertage):** Erkennt vorab manuell gebuchte Zahlungen oder Topf-Abrechnungen anhand von Betrag, Buchungsdatum-Fenster sowie IBAN/Gegenpartei/Topf und wählt sie in der Vorschau standardmäßig ab.
- **Drei konfigurierbare Import-Modi:**
  - `TWO_STAGE_PREVIEW` *(Standard)*: Erst Staging-Vorschau prüfen, Zuordnungen anpassen und dann verbindlich buchen.
  - `DIRECT_WITH_REVIEW_FLAG`: Sofortige Übernahme neuer Zeilen mit Prüfkennzeichen (`needs_review = true`, Topf-Entlastung erst nach Freigabe).
  - `DIRECT_AUTO_COMMIT`: Direkte Verbuchung inklusive sofortiger Topf-Verrechnung.
- **Automatische Klassifizierung (`TransactionMatcherInterface`):**
  - **Stufe 1 — Own-IBAN-Detektor:** Erkennt Überweisungen zwischen eigenen Haushaltskonten automatisch als `PHYSICAL_ACCOUNT_TRANSFER`.
  - **Stufe 2 — Priorisierte Regex-Regeln:** Deterministische Zuordnung von Empfänger, IBAN, Verwendungszweck und Betragsfenstern auf Kategorien und Töpfe.

### 5. Installierbare Progressive Web App (PWA)
- Offline-fähiger Service Worker (Workbox), Web-App-Manifest sowie dedizierte Desktop-, Android- und iOS-Installationsunterstützung.
- Zweisprachige Oberfläche (**Deutsch `de-DE`** / **Englisch `en-US`**) und umschaltbares **Hell-/Dunkel-Theme**.

---

## Domänenmodell & Buchhaltungsprinzipien

```text
Tenant (Haushalt / Mandant)
 ├── User (System-Login: Pangolin/Newt X-Forwarded-User oder JWT)
 ├── Person (Haushaltsmitglied / Stammdaten, auch ohne Login)
 │    └── PersonMonthlyIncome (Monatsscharfes reales Netto inkl. Boni pro YYYY-MM)
 ├── Account (Physisches Bankkonto mit IBAN & Eröffnungssaldo)
 │    └── Transaction (Reale Kontobewegung: INFLOW | OUTFLOW | PHYSICAL_ACCOUNT_TRANSFER)
 ├── BudgetCategory (Kostenkategorie mit optionalem Strategie-Override)
 ├── MatchingRule (Priorisierte Regex- & Betragsregeln für den Kontoauszugs-Import)
 └── SinkingFund / PlannedPayment (Geplante Zahlung & Virtueller Anspartopf)
      ├── SinkingFundRateRevision (Geplante Preisstaffeln mit Gültig-ab-Datum)
      └── SinkingFundLedgerEntry (Virtuelles Topf-Journal:
            INITIAL_CARRYOVER | MONTHLY_PROVISION | EXPENSE_SETTLEMENT | VIRTUAL_POT_REALLOCATION)
```

**Wichtige buchhalterische Invarianten:**
- Alle Geldbeträge im Backend verwenden `Decimal` bzw. PostgreSQL `NUMERIC(14, 2)` — niemals binäre Gleitkommazahlen (`float`) in der Persistenz- oder Domänenschicht.
- Physische Umbuchungen zwischen zwei Bankkonten (`PHYSICAL_ACCOUNT_TRANSFER`) verändern die realen Kontostände beider Bankkonten, berühren aber keinen Ausgabentopf.
- Virtuelle Umbuchungen zwischen zwei Anspartöpfen (`VIRTUAL_POT_REALLOCATION`) erzeugen immer ein summenneutrales Buchungspaar (`-X` / `+X`) im Topf-Journal und verändern keinen physischen Bankkontostand.
- Eine geplante Zahlung kann erst gelöscht werden, wenn ihr virtueller Topf-Saldo exakt `0,00 €` beträgt.

---

## Systemarchitektur & Tech-Stack

```text
                        ┌─────────────────────────────────────────┐
                        │  Pangolin / Newt (oder Reverse Proxy)   │
                        │  Setzt X-Forwarded-User / Email         │
                        └───────────────────┬─────────────────────┘
                                            │ HTTP (:8080)
                        ┌───────────────────▼─────────────────────┐
                        │  equibudget-web (Nginx 1.27 Alpine)     │
                        │  • Statische Auslieferung React 19 PWA  │
                        │  • Proxy /api/* & /health/* -> backend  │
                        └───────────────────┬─────────────────────┘
                                            │ Internes Docker-Netz
                        ┌───────────────────▼─────────────────────┐
                        │  equibudget-backend (Python 3.12)       │
                        │  • FastAPI + Pydantic v2                │
                        │  • SQLAlchemy 2.0 Async + Alembic       │
                        └───────────────────┬─────────────────────┘
                                            │ asyncpg (:5432 intern)
                        ┌───────────────────▼─────────────────────┐
                        │  equibudget-postgres (PostgreSQL 16)    │
                        │  • Named Volume: equibudget_pgdata      │
                        └─────────────────────────────────────────┘
```

| Schicht | Eingesetzte Technologien |
| :--- | :--- |
| **Backend** | Python 3.12, FastAPI, SQLAlchemy 2.0 (`AsyncSession` + `asyncpg`), Pydantic v2, Alembic, PyJWT |
| **Datenbank** | PostgreSQL 16 (`NUMERIC(14,2)`, UUIDv4-Primärschlüssel, strikte `tenant_id`-Mandantentrennung & `app.current_tenant_id` Session-Binding) |
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, Vite, `vite-plugin-pwa` (Workbox), Lucide Icons |
| **Infrastruktur** | Multi-Stage Dockerfiles (Rootless Runtime `UID 10001`), Docker Compose, Nginx Gateway, optionaler `fosrl/newt`-Container |

---

## Schnellstart mit Docker Compose

Voraussetzungen: **Docker Engine 24+** mit **Docker Compose v2**.

```bash
# 1. Repository klonen
git clone https://github.com/moritztw/equibudget.git
cd equibudget

# 2. Umgebungsdatei anlegen
cp .env.example .env

# 3. Sichere Geheimnisse erzeugen und in .env eintragen
openssl rand -hex 24   # -> als POSTGRES_PASSWORD und in EQUIBUDGET_DATABASE_URL eintragen
openssl rand -hex 32   # -> als EQUIBUDGET_JWT_SECRET_KEY eintragen

# 4. Gesamten Stack bauen und starten (führt automatisch `alembic upgrade head` aus)
docker compose up -d --build

# 5. Bereitschaft prüfen
curl -fsS http://127.0.0.1:8080/health/ready
```

Öffne anschließend **`http://127.0.0.1:8080`** im Browser.

---

## Ersteinrichtung ohne Testdaten (Setup-Assistent)

Beim allerersten Öffnen einer frischen Instanz startet EquiBudget automatisch den **5-stufigen Ersteinrichtungs-Assistenten**:

1. **Haushalt & Basis:** Name des Haushalts, Startmonat (`YYYY-MM`), Währung und Standard-Aufteilungsmodell.
2. **Personen & Einkommen:** Eigene Haushaltsmitglieder inkl. realem Nettoeinkommen für den Startmonat.
3. **Bankkonten & Kontostand:** Eigene Giro-, Gemeinschafts- und Tagesgeldkonten mit IBAN und realem aktuellem Kontostand.
4. **Kategorien:** Auswahl oder Neuanlage der gewünschten Kostenkategorien.
5. **Geplante Zahlungen & Topf-Startguthaben:** Anlage laufender Fixkosten und unterjähriger Anspartöpfe inklusive **bereits angespartem Startguthaben (`INITIAL_CARRYOVER`)** mit Live-Deckungsprüfung gegen den realen Kontostand.

Es werden dabei **keinerlei Demo- oder Testbuchungen** angelegt. Wer die Anwendung vorab unverbindlich testen möchte, kann im Assistenten optional in den Demo-Modus wechseln und später jederzeit unter *Stammdaten* eine saubere Produktiv-Instanz initialisieren.

---

## Reverse Proxy & Pangolin / Newt (Forward-Auth)

EquiBudget ist nativ für den Betrieb hinter **Pangolin / Newt** (sowie Authelia, Authentik, Traefik oder Caddy) vorbereitet:

- **Integriertes Compose-Profil für Newt:** Nach dem Eintragen von `PANGOLIN_ENDPOINT`, `NEWT_ID` und `NEWT_SECRET` in `.env` startet der WireGuard-Tunnel direkt im selben internen Docker-Netzwerk:
  ```bash
  docker compose --profile pangolin up -d --build
  ```
- **Forward-Auth-Header:** `deploy/nginx/default.conf` reicht `X-Forwarded-User`, `X-Forwarded-Email` und `X-Forwarded-Groups` unverändert an FastAPI durch. Alternativ unterstützt das Backend `Authorization: Bearer <jwt>` als Fallback.

Eine ausführliche Anleitung zu Betrieb, Backups (`pg_dump` / `pg_restore`) und Updates findest du in **[`SELF_HOSTING.md`](./SELF_HOSTING.md)**.

---

## Lokale Entwicklung

### 1. Backend (`household-budget-backend/`)

```bash
cd household-budget-backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Datenbank-Migrationen auf lokaler PostgreSQL-Instanz ausführen
export EQUIBUDGET_DATABASE_URL="postgresql+asyncpg://equibudget:equibudget@localhost:5432/equibudget"
alembic upgrade head

# Entwicklungsserver starten (OpenAPI/Swagger unter http://localhost:8000/docs)
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (Root-Verzeichnis)

```bash
npm install
npm run dev      # Startet Vite auf http://localhost:3000
npm run lint     # Strikte TypeScript-Prüfung (tsc --noEmit)
npm run build    # Produktions-Build inkl. PWA Service Worker nach dist/
```

---

## REST-API-Übersicht

Bei laufendem Backend steht die interaktive OpenAPI-/Swagger-Dokumentation unter `/docs` (bzw. `/redoc`) bereit. Alle fachlichen Endpunkte liegen unter `/api/v1`:

| Bereich | Methode & Pfad | Beschreibung |
| :--- | :--- | :--- |
| **Health** | `GET /health/live`, `GET /health/ready` | Container-Liveness & Datenbank-Readiness-Probe |
| **Ersteinrichtung** | `GET /api/v1/setup/status` | Prüft, ob bereits ein aktiver Haushalts-Mandant initialisiert wurde |
| | `POST /api/v1/setup/bootstrap` | Atomare Ersteinrichtung eigener Stammdaten & Topf-Startguthaben ohne Testdaten |
| **Mandanten** | `GET / POST /api/v1/tenants` | Haushalts-Mandanten auflisten oder neu anlegen (`X-Tenant-ID`) |
| **Personen & Netto** | `GET / POST / PATCH /api/v1/persons` | Haushaltsmitglieder (Stammdaten unabhängig von Logins) verwalten |
| | `PUT /api/v1/persons/{id}/monthly-incomes/{month}` | Monatsscharfes reales Nettoeinkommen (inkl. variabler Bezüge) erfassen |
| **Konten & Deckung** | `GET / POST /api/v1/accounts` | Physische Bankkonten und Eröffnungssalden verwalten |
| | `GET /api/v1/accounts/{id}/liquidity` | Abstimmung: Realer Kontostand vs. gebundene (+) & überzogene (−) Töpfe |
| **Zahlungsplan & Töpfe** | `GET / POST / PATCH / DELETE /api/v1/sinking-funds` | Geplante Zahlungen, `end_date`, `rate_revisions` & Lifecycle-Filter (`ACTIVE`/`ARCHIVED`) |
| | `POST /api/v1/sinking-funds/{id}/provisions` | Monatliche Ansparrate in virtuellen Topf buchen |
| | `POST /api/v1/sinking-funds/{id}/settle` | Rechnung aus Topf begleichen (auch bei Unterdeckung / Topf-Überziehung) |
| | `POST /api/v1/sinking-funds/reallocate` | Rein virtuelle Umbuchung zwischen zwei Töpfen ohne Banktransaktion |
| **Einkommens-Split** | `GET /api/v1/allocations/monthly-plan` | Kompletter Monatsplan & Umlageberechnung für den gewählten Referenzmonat |
| | `POST /api/v1/allocations/simulate` | Zustandslose Simulation beliebiger Aufteilungsstrategien |
| **Ist-Zahlungen & CSV** | `GET / POST / PATCH /api/v1/transactions` | Buchungsjournal filtern, manuell buchen oder Kategorie/Topf neu zuordnen |
| | `POST /api/v1/imports/statements` | DKB-CSV hochladen (inkl. `EXACT_HASH`- & `SEMANTIC_MATCH`-Duplikatprüfung) |
| | `POST /api/v1/imports/batches/{id}/commit` | Zweistufigen Import-Batch verbindlich ins Hauptbuch übernehmen |
| | `GET / POST /api/v1/matching-rules` | Priorisierte Regex-Zuordnungsregeln verwalten |

---

## Projektstruktur

```text
.
├── docker-compose.yml                  # Produktions-Stack (Postgres 16, FastAPI, Nginx PWA, optional Newt)
├── Dockerfile                          # Multi-Stage Build für Frontend-PWA + Nginx Reverse Proxy
├── .env.example                        # Dokumentierte Umgebungsvariablen für Self-Hosting
├── SELF_HOSTING.md                     # Betriebshandbuch (Pangolin/Newt, Backups, Updates)
├── deploy/nginx/default.conf           # Nginx Gateway-, Caching- & Forward-Auth-Konfiguration
├── household-budget-backend/           # Python 3.12 / FastAPI / SQLAlchemy 2.0 Backend
│   ├── Dockerfile                      # Schlankes Multi-Stage Image (Rootless UID 10001)
│   ├── docker-entrypoint.sh            # Automatische Alembic-Migration + Uvicorn-Start
│   ├── alembic/                        # Async Alembic-Umgebung & Initial-Schema-Migration
│   └── app/
│       ├── api/                        # FastAPI Dependencies (Tenant, Forward-Auth, JWT), RFC 7807 Errors & Router
│       ├── core/                       # Zentrale Pydantic-Settings Konfiguration
│       ├── db/                         # SQLAlchemy 2.0 AsyncEngine, Session-Lifecycle & Mixins
│       ├── domain/                     # Reine Fachlogik (AllocationEngine, AccrualEngine, Money/Hare-Niemeyer)
│       ├── importers/                  # StatementParserInterface & DKB-CSV-Parser (Modern + Legacy)
│       ├── matching/                   # Own-IBAN-Transfer-Detektor & priorisierte Regex-Engine
│       ├── models/                     # SQLAlchemy-Entitäten & Enums
│       ├── repositories/               # Mandantenisolierte Async-Repositories & Duplikat-Prüfung
│       └── schemas/                    # Strikte Pydantic-v2-Request/Response-Verträge
└── src/                                # React 19 / TypeScript / Tailwind CSS v4 PWA
    ├── api/apiClient.ts                # Typisierter REST-Client für FastAPI (/api/v1)
    ├── components/                     # ERP-Views (12M-Matrix, Ist-Zahlungen, Split, Töpfe, Setup-Wizard, Stammdaten)
    ├── domain/                         # Typen & deterministische Berechnungs-/CSV-Engine
    ├── i18n/                           # Zweisprachige Wörterbücher (de-DE / en-US) & Intl-Formatierer
    ├── pwa/                            # Installations-Button, iOS-Anleitung & Offline-Indikator
    └── store/                          # Zentraler Haushalts-State inkl. Persistenz
```
