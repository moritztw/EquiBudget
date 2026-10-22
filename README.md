# Hauptmerkmale
Fair-Split-Verteilschlüssel: Flexible Aufteilungsmodelle für gemeinsame Ausgaben – z. B. 50/50, proportional zum Nettoeinkommen oder das Modell "Gleiches Taschengeld" (beide Personen behalten nach Abzug aller gemeinsamen Ausgaben exakt den gleichen Betrag zur freien Verfügung).

Rückstellungen & Virtuelle Töpfe (Accrual Accounting): Periodische Ausgaben (quartalsweise, jährlich etc.) werden automatisch in monatliche Anspar-Raten zerlegt, um überraschende Abbuchungen zu vermeiden.

Erweiterbare Matching-Pipeline: Import von Kontoauszügen (XLS/CSV) mit modularer Mustererkennung (Regex/Regeln) und vorbereiteter Schnittstelle für LLM/KI-basierte Kategorisierung.

Personen- & Nutzer-Konzept: Unterscheidung zwischen System-Nutzern und Haushaltsmitgliedern ohne eigenen Login.

Forward-Auth Support: Entwickelt für den Betrieb hinter Reverse Proxies (z. B. Pangolin, Newt, Authelia) via Proxy-Header (X-Forwarded-User).

Mehrsprachigkeit (i18n): Native Unterstützung für Deutsch und Englisch inkl. lokalisierter Datums- und Währungsformatierung.

# Architektur
Das Projekt ist in zwei unabhängige Repositories aufgeteilt:

Backend: REST-API (FastAPI / PostgreSQL)

Frontend: Single Page Application (Vue 3 / Tailwind CSS)

Die Bereitstellung erfolgt vollcontainerisiert über eine gemeinsame docker-compose.yml.

# Full Disclosure: AI-Assisted Development
Dieses Projekt wurde mit Unterstützung von KI-Systemen konzipiert und umgesetzt:

Architektur & Prompt Engineering: Die Spezifikation, das Datenmodell, die mathematischen Verteilungsmodelle und die Systemarchitektur wurden mithilfe von Google AI Studio (Gemini 1.5 Pro) entworfen und optimiert.

Code-Generierung: Das Grundgerüst für Backend, Frontend, i18n-Übersetzungen und Docker-Setups wurde durch LLMs generiert und anschließend manuell für den Produktivbetrieb angepasst und gepflegt.
