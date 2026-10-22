# EquiBudget ⚖️
> **Self-Hosted Multi-Tenant Household Finance, Equitable Cashflow Splits & Accrual Engine**

EquiBudget ist eine datenschutzorientierte, selbst gehostete Plattform für modernes Haushalts- und Finanzmanagement in Partnerschaften, Familien und Wohngemeinschaften. Im Zentrum stehen **mathematisch faire Ausgabenaufteilungen** (inklusive des Modells *„Gleiches Taschengeld“*), **periodengerechte Rücklagenbildung (Sinking Funds)** zur Glättung großer Jahresrechnungen sowie eine **mehrstufige Matching-Pipeline** für Banktransaktionen.

---

## Inhaltsverzeichnis
- [1. Hauptfunktionen](#1-hauptfunktionen)
  - [1.1 Dynamische Verteilschlüssel & „Gleiches Taschengeld“](#11-dynamische-verteilschlüssel--gleiches-taschengeld)
  - [1.2 Accrual Accounting: Virtuelle Rücklagen-Töpfe (Sinking Funds)](#12-accrual-accounting-virtuelle-rücklagen-töpfe-sinking-funds)
  - [1.3 Transaktions-Import & 2-stufige Matching-Pipeline](#13-transaktions-import--2-stufige-matching-pipeline)
  - [1.4 Personen vs. System-Nutzer & Multi-Tenancy](#14-personen-vs-system-nutzer--multi-tenancy)
  - [1.5 Vollständige Mehrsprachigkeit (i18n) & Lokalisierung](#15-vollständige-mehrsprachigkeit-i18n--lokalisierung)
- [2. Systemarchitektur](#2-systemarchitektur)
  - [2.1 Repository-Struktur](#21-repository-struktur)
  - [2.2 Domain-Datenmodell (ERD-Übersicht)](#22-domain-datenmodell-erd-übersicht)
- [3. Schnellstart (Docker Compose)](#3-schnellstart-docker-compose)
- [4. Authentifizierung (Forward-Auth & Zero-Trust)](#4-authentifizierung-forward-auth--zero-trust)
- [5. API-Fehlerbehandlung (i18n-Standard)](#5-api-fehlerbehandlung-i18n-standard)
- [6. Full Disclosure: KI-gestützte Entwicklung](#6-full-disclosure-ki-gestützte-entwicklung)

---

## 1. Hauptfunktionen

### 1.1 Dynamische Verteilschlüssel & „Gleiches Taschengeld“
Das System löst eines der größten Spannungsfelder im Zusammenleben: die gerechte Aufteilung von Fixkosten bei Gehaltsdiskrepanzen.

* **Modell „Gleiches Taschengeld“ (*Equal Remaining Amount*, empfohlen):**
  Nach Abzug aller gemeinsamen monatlichen Fixkosten und Rücklagenanteile behalten alle erwerbstätigen Partner **auf den Cent genau denselben Betrag** als frei verfügbares Taschengeld für persönliche Hobbys, private Altersvorsorge oder eigene Anschaffungen.
  
  $$\text{Discretionary Pool} = \left( \sum_{i=1}^N \text{Netto}_i + \text{Haushaltseinkommen}_{\text{global}} \right) - \text{Gemeinsame Ausgaben}$$
  $$\text{Taschengeld pro Person} = \frac{\text{Discretionary Pool}}{N_{\text{Verdiener}}}$$
  $$\text{Überweisung Gemeinschaftskonto}_i = \text{Netto}_i - \text{Taschengeld pro Person}$$

* **Proportional zum Nettoeinkommen:** Jeder Partner trägt gemäß seinem relativen prozentualen Anteil am Gesamteinkommen zu den Gemeinschaftskosten bei.
* **Feste Quote (50/50, 60/40 etc.):** Starre prozentuale Aufteilung der Gemeinschaftsausgaben.
* **Globales Haushaltseinkommen (z. B. deutsches Kindergeld):** Wird dem Gemeinschaftskonto direkt gutgeschrieben und senkt vorab den von den Partnern aufzubringenden Anteil.

### 1.2 Accrual Accounting: Virtuelle Rücklagen-Töpfe (Sinking Funds)
Unerwartete Abbuchungen (z. B. Kfz-Versicherung im Januar für 1.200 € oder Fernwärme-Quartalsabschlag für 450 €) führen in Haushaltsbudgets oft zu Liquiditätsengpässen.

* **Monatlicher Anspar-Anteils-Rechner:** Rechnet periodische Rechnungen (wöchentlich, quartalsweise, halbjährlich, jährlich) in planbare Monatsraten um (z. B. 1.200 €/Jahr = 100 €/Monat).
* **Virtuelle Töpfe auf Realkonten:** Anstatt Dutzende Bank-Unterkonten zu eröffnen, verwaltet EquiBudget virtuelle Rücklagen auf Ihrem bestehenden Giro- oder Tagesgeldkonto.
* **Abbuchungs-Verrechnung (*Debit Offset*):** Trifft die reale Rechnung auf dem Girokonto ein, wird die Transaktion gegen den angesparten virtuellen Topf verrechnet. Das Monatsbudget bleibt unangetastet geglättet.
* **Topf-Umbuchungen (*Rebalancing*):** Überschüsse (z. B. aus dem Urlaubstopf) können flexibel in andere Töpfe umgebucht werden.

### 1.3 Transaktions-Import & 2-stufige Matching-Pipeline
EquiBudget unterstützt den Import von CSV- und CAMT.053-Bankauszügen (vorkonfigurierte Profile für DKB, Commerzbank, Revolut etc.):

1. **Stufe 1 (Deterministische Regeln & Mustererkennung):**
   * Exakter IBAN-Abgleich (z. B. Vermieter-IBAN $\to$ *Warmmiete*)
   * Regex- & Schlagwortsuche (z. B. `/REWE|EDEKA|ALDI/i` $\to$ *Lebensmittel*)
   * Automatische Erkennung fälliger Sinking-Fund-Abbuchungen
2. **Stufe 2 (Modulare KI-Klassifizierung):**
   * Unbekannte Buchungen werden an einen KI-Hook (z. B. Google Gemini API oder lokales Ollama) übergeben.
   * Das Modell liefert Kategoriezuordnung, Konfidenzwert (z. B. 94 %) und eine nachvollziehbare Begründung.

### 1.4 Personen vs. System-Nutzer & Multi-Tenancy
* **Multi-Tenancy:** Eine Instanz kann mehrere Haushalte (*Tenants*) strikt getrennt voneinander verwalten (z. B. Familie und Ferienwohnung).
* **Personen vs. Benutzer:** Eine Person im Haushalt (z. B. Kind *Leo* oder Haustier) muss kein registrierter Systemnutzer mit Login sein, kann aber Einnahmen (Kindergeld) und Ausgabenkategorien zugeordnet werden.

### 1.5 Vollständige Mehrsprachigkeit (i18n) & Lokalisierung
* Native Unterstützung für **Deutsch (`de-DE`)** und **Englisch (`en-US`)** über dateibasierte Sprachdateien (`/src/locales/de.json` & `/src/locales/en.json`).
* Automatische Erkennung der Browsersprache (`navigator.language`) mit Sprachumschalter in der Navigation und `localStorage`-Persistenz.
* Standardisierte Zahlen-, Prozent- und Währungsformatierung (`1.234,56 €` vs. `€1,234.56`) über native Browser-`Intl`-APIs.

---

## 2. Systemarchitektur

Das Gesamtsystem ist strikt nach Clean-Architecture-Prinzipien entworfen und in zwei eigenständige Komponenten aufgeteilt:

```text
                           ┌─────────────────────────────────────────┐
                           │      Reverse Proxy (Pangolin / Newt)     │
                           │   Forward-Auth & SSL-Terminierung       │
                           └────────────────────┬────────────────────┘
                                                │
                          X-Forwarded-User: moritz@example.com
                                                ▼
     ┌────────────────────────────────────────────────────────────────────────┐
     │                     equibudget-network (Docker Bridge)                 │
     │                                                                        │
     │   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
     │   │ household-budget-frontend │      │  household-budget-backend   │   │
     │   │   SPA (React / Vue 3)     │─────▶│   REST-API (FastAPI)        │   │
     │   │   Nginx Webserver / Vite  │      │   Pydantic v2 Engines       │   │
     │   └───────────────────────────┘      └──────────────┬──────────────┘   │
     │                                                     │                  │
     │                                                     ▼                  │
     │                                      ┌─────────────────────────────┐   │
     │                                      │          db (RDBMS)         │   │
     │                                      │     PostgreSQL 16 Alpine    │   │
     │                                      │     Named Volume Data       │   │
     │                                      └─────────────────────────────┘   │
     └────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Repository-Struktur

```text
.
├── docker-compose.yml                 # Orchestrierung von db, backend und frontend
├── .env.docker.example                # Vorlage für Produktions-Umgebungsvariablen
│
├── household-budget-backend/          # Backend REST-API (Python / FastAPI)
│   ├── app/
│   │   ├── core/                      # Forward-Auth, JWT, DB-Engine, Error-Handler
│   │   ├── domain/
│   │   │   ├── entities/              # Tenant, User, Person, SinkingFund, Transaction
│   │   │   └── engines/               # AllocationEngine, AccrualCalculator, TransactionMatcher
│   │   ├── infrastructure/            # SQLAlchemy 2.0 ORM, Alembic, Repositories, AI-Plugins
│   │   ├── services/                  # Business-Logik & Use-Cases
│   │   └── api/v1/                    # REST Controller & OpenAPI Schemas
│   └── Dockerfile
│
└── household-budget-frontend/         # Single Page Application
    ├── src/
    │   ├── locales/                   # en.json & de.json Übersetzungen
    │   ├── services/                  # LocaleFormatter (Intl.NumberFormat & Intl.DateTimeFormat)
    │   ├── i18n/                      # I18nContext & t() Hook
    │   ├── engines/                   # Client-seitige Berechnungsspiegel
    │   ├── components/                # CashflowSankey, LanguageSwitcher, Cards, Modals
    │   └── views/                     # CashflowView, SinkingFundsView, ImportView, BlueprintView
    └── Dockerfile
```

### 2.2 Domain-Datenmodell (ERD-Übersicht)

* **Tenants (Haushalte):** Mandantengrenze mit Währung und Zeitzone.
* **Users:** Authentifizierte Konten via Forward-Auth Header oder JWT.
* **Persons:** Reale Haushaltsmitglieder (Verdiener vs. Nicht-Verdiener).
* **IncomeSources:** Persönliches Netto oder globales Haushaltseinkommen.
* **Budgets:** Laufende monatliche Budgetkategorien (Miete, Lebensmittel, Kita).
* **RecurringExpenses & VirtualSinkingFunds:** 1:1 gekoppelte periodische Rücklagen mit Turnus und monatlicher Ansparrate.
* **Accounts & Transactions:** Reale Bankkonten und importierte Buchungen mit Zuweisungsstatus.

---

## 3. Schnellstart (Docker Compose)

### Voraussetzungen
* Docker Engine $\ge$ 24.0
* Docker Compose $\ge$ v2.20

### 1. Repository klonen & Umgebung einrichten
```bash
git clone https://github.com/moritztw/EquiBudget.git
cd equibudget

# Konfigurationsdatei aus Vorlage erzeugen:
cp .env.docker.example .env
```

### 2. Umgebungsvariablen anpassen (`.env`)
Öffnen Sie die `.env`-Datei und setzen Sie sichere Kennwörter:
```ini
POSTGRES_DB=equibudget
POSTGRES_USER=equibudget
POSTGRES_PASSWORD=WaehleHierEinSicheresPasswort!

# Authentifizierungsmodus: 'reverse_proxy' oder 'standalone_jwt'
AUTH_MODE=reverse_proxy
FORWARDED_USER_HEADER=X-Forwarded-User

# Web-Port des Frontends
FRONTEND_PORT=3000
```

### 3. Stack starten
```bash
docker compose up -d --build
```

Nach erfolgreichem Build ist die Anwendung unter `http://localhost:3000` erreichbar. Die Datenbank initialisiert sich automatisch und das Backend wartet via Healthcheck auf deren Verfügbarkeit.

---

## 4. Authentifizierung (Forward-Auth & Zero-Trust)

EquiBudget wurde primär für den Betrieb im **Self-Hosted-Homelab** hinter Reverse Proxies (wie **Pangolin**, **Newt**, **Authelia**, **Authentik** oder **Traefik**) entwickelt.

### Header-basierte Authentifizierung (Empfohlen)
Bei aktivem `AUTH_MODE=reverse_proxy` vertraut das Backend den vom Ingress-Proxy injizierten HTTP-Headern:

| Header-Name | Bedeutung | Beispielwert |
| :--- | :--- | :--- |
| `X-Forwarded-User` | Eindeutige Benutzerkennung / Login | `moritz.schneider` |
| `X-Auth-Request-Email` | E-Mail-Adresse des Nutzers | `moritz@example.com` |
| `X-Forwarded-Groups` | Rollen & Berechtigungen | `household-admin, finance` |

Das Backend ordnet die Identität automatisch dem entsprechenden Tenant-Nutzer zu oder legt bei Erstaufruf das Nutzerprofil sicher im Mandanten an.

### Standalone JWT Fallback
Für lokale Tests oder isolierte Umgebungen ohne Reverse Proxy kann `AUTH_MODE=standalone_jwt` aktiviert werden. In diesem Modus stellt das Backend bei erfolgreicher Anmeldung signierte Bearer-JWTs (`HS256`/`RS256`) aus.

---

## 5. API-Fehlerbehandlung (i18n-Standard)

Um Mehrsprachigkeit im Frontend vollständig zu gewährleisten, gibt das Backend keine hartkodierten Fehlermeldungen zurück, sondern maschinenlesbare Fehlercodes:

```json
{
  "error_code": "ERR_ACCOUNT_NOT_FOUND",
  "message": "Account with ID 123 does not exist.",
  "details": {
    "account_id": "123"
  }
}
```

Das Frontend übersetzt diese Schlüssel dynamisch über die Sprachdateien:
* `ERR_NO_ACTIVE_EARNERS` $\to$ *„Der Haushalt muss mindestens eine Person mit Einkommen aufweisen.“*
* `ERR_INSUFFICIENT_FUNDS` $\to$ *„Nicht genügend Guthaben im virtuellen Topf für diese Umbuchung vorhanden.“*
* `ERR_INVALID_IMPORT_FORMAT` $\to$ *„Ungültiges Dateiformat im importierten Kontoauszug.“*

---

## 6. Full Disclosure: KI-gestützte Entwicklung

Dieses Projekt wurde mit substanzieller Unterstützung moderner KI-Systeme konzipiert und realisiert:

* **Konzeption & Prompt Engineering:** Die Spezifikation der Fachdomäne, die mathematische Herleitung des Verteilungsmodells (*„Gleiches Taschengeld“*), die Architektur der Accrual-Rücklagen und das relationale ERD-Modell wurden unter Zuhilfenahme von **Google AI Studio** und **Gemini** erarbeitet.
* **Code-Generierung & Refactoring:** Der funktionale Code für Backend-Engines (FastAPI / Pydantic v2), das Frontend (React / Tailwind CSS / SVG Sankey), die standardisierten i18n-Übersetzungen (`de.json`, `en.json`) sowie die produktionsreife `docker-compose.yml` wurden mithilfe von LLMs generiert, iteriert und durch Integrationstests abgesichert.
* **Wartung & Weiterentwicklung:** Die Codebasis folgt klaren architektonischen Mustern (Clean Architecture, Domain Separation, Typsicherheit), sodass sie sowohl von menschlichen Entwicklern als auch KI-gestützten Coding-Assistenten transparent gewartet und erweitert werden kann.

---

## Lizenz
Veröffentlicht unter der [Apache-2.0 Lizenz](LICENSE).  
Entwickelt für faire Finanzen und transparente Haushaltsplanung. ⚖️
