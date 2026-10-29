# EquiBudget — Self-Hosting & Betriebshandbuch

Dieses Repository enthält das vollständige Self-Hosting-Setup für **EquiBudget** (Multi-Tenant Haushalts-ERP mit Sinking-Fund-Rückstellungen, Einkommens-Aufteilung, DKB-CSV-Import und PWA-Unterstützung).

## 1. Architektur im Container-Betrieb

Alle Komponenten laufen isoliert im internen Docker-Netzwerk `equibudget_internal`. Lediglich der `web`-Gateway-Port (Standard `127.0.0.1:8080`) wird nach außen bzw. an **Pangolin / Newt** bereitgestellt:

1. **`equibudget-postgres` (`postgres:16-alpine`):** Persistente PostgreSQL-16-Datenbank auf dem Named Volume `equibudget_pgdata` (exakte `NUMERIC(14,2)`-Arithmetik, kein öffentlicher Port).
2. **`equibudget-backend` (`household-budget-backend/Dockerfile`):** Python 3.12 / FastAPI / SQLAlchemy 2.0 (`asyncpg`). Führt beim Start über `docker-entrypoint.sh` automatisch `alembic upgrade head` aus und startet anschließend `uvicorn` als unprivilegierter Systemnutzer (`UID 10001`).
3. **`equibudget-web` (`Dockerfile` + `deploy/nginx/default.conf`):** Auslieferung der kompilierten React-19-PWA inklusive Service-Worker-Caching-Regeln sowie Reverse-Proxy für `/api/*` und `/health/*` unter vollständiger Weitergabe von `X-Forwarded-User` / `X-Forwarded-Email`.
4. **`equibudget-newt` (optional über `--profile pangolin`):** Vorbereiteter `fosrl/newt`-Tunnel-Client für Pangolin ohne offene Firewall-Ports im Heimnetz.

---

## 2. Schnellstart (Erstinbetriebnahme)

```bash
# 1. Konfigurationsdatei anlegen
cp .env.example .env

# 2. Sicheres Datenbank-Passwort und 32-Byte-JWT-Secret generieren und in .env eintragen
openssl rand -hex 24   # -> als POSTGRES_PASSWORD in .env setzen
openssl rand -hex 32   # -> als EQUIBUDGET_JWT_SECRET_KEY in .env setzen

# 3. Stack bauen und im Hintergrund starten (inkl. automatischer Alembic-Migration)
docker compose up -d --build

# 4. Gesundheitsstatus prüfen
docker compose ps
curl -fsS http://127.0.0.1:8080/health/ready
```

---

## 3. Erster Aufruf & Setup-Assistent (ohne Testdaten)

Beim ersten Öffnen von `http://127.0.0.1:8080` (bzw. deiner Pangolin-Domain) erkennt EquiBudget automatisch eine frische Instanz und startet den **5-stufigen Ersteinrichtungs-Assistenten**:

1. **Haushalt & Basis:** Haushaltsname, Startmonat (`YYYY-MM`), Währung und Standard-Aufteilungsmodell (z. B. *Gleiches Taschengeld*).
2. **Personen & Einkommen:** Eigene Haushaltsmitglieder inkl. realem Netto für den Startmonat.
3. **Bankkonten & Kontostand:** Eigene Giro-/Gemeinschafts-/Tagesgeldkonten mit IBAN (für die automatische Kontotransfer-Erkennung) und aktuellem realem Kontostand.
4. **Kategorien:** Auswahl oder Anlage der eigenen Kostenkategorien.
5. **Töpfe & Startguthaben (`INITIAL_CARRYOVER`):** Anlage wiederkehrender Zahlungen und virtueller Anspartöpfe inklusive **Startguthaben im Topf**, abgestimmt gegen den realen Kontostand.

Es werden dabei **keinerlei Test- oder Demo-Buchungen** in die Datenbank geschrieben.

---

## 4. Anbindung an Pangolin / Newt (Forward-Auth)

### Variante A: Newt direkt im selben Compose-Stack mitstarten
Trage `PANGOLIN_ENDPOINT`, `NEWT_ID` und `NEWT_SECRET` in `.env` ein und starte mit:

```bash
docker compose --profile pangolin up -d --build
```

Konfiguriere in der Pangolin-Oberfläche als Ressource-Ziel einfach:
- **Target Host:** `http://web:8080`
- **SSO / Forward-Auth:** Aktivieren (Pangolin setzt `X-Forwarded-User` und `X-Forwarded-Email`; `deploy/nginx/default.conf` reicht diese Header unverändert an FastAPI durch).

### Variante B: Vorhandener zentraler Newt-Agent oder Reverse Proxy auf dem Host
Belasse `EQUIBUDGET_BIND_ADDRESS=127.0.0.1` (oder die LAN-IP deines Hosts) und zeige in Pangolin / Caddy / Traefik auf `http://127.0.0.1:8080`.

---

## 5. Backup, Restore & Updates

### Datenbank-Backup erstellen (`pg_dump`)
```bash
docker exec equibudget-postgres pg_dump -U equibudget -Fc equibudget > equibudget_$(date +%F).dump
```

### Datenbank-Backup wiederherstellen (`pg_restore`)
```bash
cat equibudget_2026-10-29.dump | docker exec -i equibudget-postgres pg_restore -U equibudget -d equibudget --clean --if-exists
```

### Update auf eine neue Version
```bash
git pull
docker compose up -d --build
```
Beim Container-Neustart führt `equibudget-backend` automatisch `alembic upgrade head` aus, bevor `uvicorn` Anfragen entgegennimmt.
