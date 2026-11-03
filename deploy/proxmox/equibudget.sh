#!/usr/bin/env bash
# ==============================================================================
# EquiBudget — Proxmox VE LXC Erstellungs-, Installations- & Update-Skript
# Repository: https://github.com/moritztw/EquiBudget
#
# Aufruf auf dem Proxmox-VE-Host (Erstellung eines neuen LXC-Containers):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/moritztw/EquiBudget/main/deploy/proxmox/equibudget.sh)"
#
# Aufruf innerhalb des LXC-Containers (Update / Status):
#   equibudget update   (oder kurz: update)
#   equibudget status
# ==============================================================================

set -Eeuo pipefail

readonly APP_NAME="EquiBudget"
readonly REPO_URL="${EQUIBUDGET_REPO_URL:-https://github.com/moritztw/EquiBudget.git}"
readonly REPO_BRANCH="${EQUIBUDGET_REPO_BRANCH:-main}"
readonly RAW_SCRIPT_URL="${EQUIBUDGET_RAW_SCRIPT_URL:-https://raw.githubusercontent.com/moritztw/EquiBudget/${REPO_BRANCH}/deploy/proxmox/equibudget.sh}"

readonly APP_ROOT="/opt/equibudget"
readonly REPO_DIR="${APP_ROOT}/app"
readonly VENV_DIR="${APP_ROOT}/venv"
readonly WEB_ROOT="/var/www/equibudget"
readonly CONFIG_DIR="/etc/equibudget"
readonly ENV_FILE="${CONFIG_DIR}/equibudget.env"
readonly BACKUP_DIR="/var/backups/equibudget"
readonly SERVICE_NAME="equibudget-backend"
readonly SYSTEM_USER="equibudget"

# Standardwerte für die LXC-Erstellung auf dem Proxmox-Host
OS_DISTRO="${OS_DISTRO:-debian}"
OS_VERSION="${OS_VERSION:-13}"
CT_UNPRIVILEGED="${CT_UNPRIVILEGED:-1}"
CTID="${CTID:-}"
HOSTNAME_CT="${HOSTNAME_CT:-equibudget}"
DISK_SIZE="${DISK_SIZE:-6}"
CORE_COUNT="${CORE_COUNT:-2}"
RAM_SIZE="${RAM_SIZE:-1024}"
SWAP_SIZE="${SWAP_SIZE:-512}"
BRIDGE="${BRIDGE:-vmbr0}"
NET_IP="${NET_IP:-dhcp}"
GATEWAY="${GATEWAY:-}"
VLAN_TAG="${VLAN_TAG:-}"
TZ_VALUE="${TZ:-Europe/Berlin}"
FORWARD_AUTH_ENABLED="${FORWARD_AUTH_ENABLED:-true}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"

CONTAINER_CREATED=0
TEMP_SCRIPT_FILE=""
HOST_ARCH=""

# ------------------------------------------------------------------------------
# Ausgabefunktionen
# ------------------------------------------------------------------------------
farbe_blau='\033[1;34m'
farbe_gruen='\033[1;32m'
farbe_gelb='\033[1;33m'
farbe_rot='\033[1;31m'
farbe_reset='\033[0m'

info()  { printf "${farbe_blau}[INFO]${farbe_reset} %s\n" "$*"; }
ok()    { printf "${farbe_gruen}[OK]${farbe_reset}   %s\n" "$*"; }
warn()  { printf "${farbe_gelb}[WARN]${farbe_reset} %s\n" "$*" >&2; }
err()   { printf "${farbe_rot}[FEHLER]${farbe_reset} %s\n" "$*" >&2; }
abbruch() { err "$*"; exit 1; }

aufraeumen_bei_exit() {
  if [[ -n "${TEMP_SCRIPT_FILE}" && -f "${TEMP_SCRIPT_FILE}" ]]; then
    rm -f "${TEMP_SCRIPT_FILE}"
  fi
}

fehler_rollback_host() {
  local zeile="$1" befehl="${2:-unbekannt}"
  trap - ERR
  err "Installation fehlgeschlagen in Zeile ${zeile} (Befehl: ${befehl})."
  if [[ "${CONTAINER_CREATED}" -eq 1 && -n "${CTID}" ]]; then
    CONTAINER_CREATED=0
    warn "Bereinige unvollständigen LXC-Container ${CTID}..."
    pct stop "${CTID}" >/dev/null 2>&1 || true
    pct destroy "${CTID}" --purge >/dev/null 2>&1 || true
  fi
}

trap aufraeumen_bei_exit EXIT

# ------------------------------------------------------------------------------
# Validierungsfunktionen
# ------------------------------------------------------------------------------
validiere_pos_int() {
  local wert="$1" min="${2:-1}" max="${3:-9999999}"
  [[ "${wert}" =~ ^[0-9]+$ ]] && (( wert >= min && wert <= max ))
}

validiere_hostname() {
  local name="$1"
  [[ "${#name}" -le 63 && "${name}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]
}

validiere_ipv4() {
  local ip="$1"
  [[ "${ip}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local IFS='.'
  read -r o1 o2 o3 o4 <<< "${ip}"
  for oktett in "${o1}" "${o2}" "${o3}" "${o4}"; do
    (( 10#${oktett} >= 0 && 10#${oktett} <= 255 )) || return 1
  done
}

validiere_cidr() {
  local cidr="$1"
  [[ "${cidr}" == */* ]] || return 1
  local ip="${cidr%/*}" prefix="${cidr#*/}"
  validiere_ipv4 "${ip}" || return 1
  validiere_pos_int "${prefix}" 8 32 || return 1
}

ist_root() {
  local effektive_uid="${EQUIBUDGET_TEST_EUID:-${EUID}}"
  [[ "${effektive_uid}" -eq 0 ]] || abbruch "Dieses Skript muss als root ausgeführt werden."
}

zeige_hilfe() {
  cat <<'EOF'
EquiBudget — Proxmox VE LXC Installer & Updater

Verwendung:
  Auf dem Proxmox-Host:
    bash equibudget.sh                Startet den interaktiven whiptail-Assistenten
    NONINTERACTIVE=1 bash equibudget.sh  Erstellt den LXC-Container mit Standard-/Umgebungswerten

  Im LXC-Container:
    equibudget update                 Aktualisiert EquiBudget inkl. DB-Backup & Alembic-Migration
    equibudget status                 Zeigt Dienst- und Readiness-Status an
    equibudget --install-guest        Interne Erstinstallation im frischen Container

Optionale Umgebungsvariablen (Proxmox-Host):
  CTID, HOSTNAME_CT, DISK_SIZE, CORE_COUNT, RAM_SIZE, SWAP_SIZE,
  BRIDGE, NET_IP (dhcp oder IPv4/CIDR), GATEWAY, VLAN_TAG,
  TEMPLATE_STORAGE, CONTAINER_STORAGE, FORWARD_AUTH_ENABLED (true|false),
  OS_DISTRO (debian|ubuntu), OS_VERSION (13|24.04), NONINTERACTIVE (0|1)
EOF
}

# ==============================================================================
# TEIL 1: PROXMOX-VE-HOST-ORCHESTRIERUNG
# ==============================================================================
pruefe_proxmox_umgebung() {
  ist_root
  command -v pct >/dev/null 2>&1 || abbruch "'pct' nicht gefunden. Bitte auf einem Proxmox-VE-Host ausführen."
  command -v pveversion >/dev/null 2>&1 || abbruch "'pveversion' nicht gefunden."

  HOST_ARCH="$(dpkg --print-architecture)"
  [[ "${HOST_ARCH}" == "amd64" || "${HOST_ARCH}" == "arm64" ]] || abbruch "Nicht unterstützte Host-Architektur '${HOST_ARCH}' (erwartet: amd64 oder arm64)."

  local pve_ver pve_major
  pve_ver="$(pveversion | awk -F'/' '{print $2}' | cut -d'-' -f1)"
  pve_major="${pve_ver%%.*}"
  if ! validiere_pos_int "${pve_major}" 8 99; then
    abbruch "Proxmox VE 8.0 oder neuer erforderlich (gefunden: ${pve_ver})."
  fi
}

ctid_ist_frei() {
  local id="$1"
  ! pct status "${id}" >/dev/null 2>&1 && ! qm status "${id}" >/dev/null 2>&1
}

waehle_storage() {
  local content_typ="$1" titel="$2" voreinstellung="${3:-}"
  if [[ -n "${voreinstellung}" ]]; then
    printf '%s' "${voreinstellung}"
    return 0
  fi

  local zeilen=()
  while IFS= read -r zeile; do
    [[ -n "${zeile}" ]] && zeilen+=("${zeile}")
  done < <(pvesm status -content "${content_typ}" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1 "|" $2}')

  (( ${#zeilen[@]} > 0 )) || abbruch "Kein aktiver Proxmox-Storage für Inhaltstyp '${content_typ}' gefunden."

  if (( ${#zeilen[@]} == 1 )) || [[ "${NONINTERACTIVE}" == "1" ]]; then
    printf '%s' "${zeilen[0]%%|*}"
    return 0
  fi

  local menu_eintraege=()
  for eintrag in "${zeilen[@]}"; do
    local name="${eintrag%%|*}" typ="${eintrag#*|}"
    menu_eintraege+=("${name}" "Typ: ${typ}")
  done

  whiptail --backtitle "Proxmox VE Community-Style Installer — ${APP_NAME}" \
    --title "${titel}" \
    --menu "Bitte Ziel-Storage auswählen:" 14 64 6 \
    "${menu_eintraege[@]}" 3>&1 1>&2 2>&3
}

dialog_erweiterte_einstellungen() {
  local os_wahl
  os_wahl="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Betriebssystem" \
    --menu "Basis-Template für den LXC-Container wählen:" 12 68 2 \
    "debian13" "Debian 13 Trixie (Standard — Python 3.13 & PostgreSQL 17)" \
    "ubuntu2404" "Ubuntu 24.04 LTS Noble (Python 3.12 & PostgreSQL 16)" \
    3>&1 1>&2 2>&3)"
  if [[ "${os_wahl}" == "ubuntu2404" ]]; then
    OS_DISTRO="ubuntu"
    OS_VERSION="24.04"
  else
    OS_DISTRO="debian"
    OS_VERSION="13"
  fi

  local ct_typ_wahl
  ct_typ_wahl="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Container-Typ" \
    --menu "Sicherheitsisolation wählen:" 12 68 2 \
    "1" "Unprivileged (Empfohlen)" \
    "0" "Privileged" \
    3>&1 1>&2 2>&3)"
  CT_UNPRIVILEGED="${ct_typ_wahl}"

  while true; do
    local eingabe_ctid
    eingabe_ctid="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Container-ID" \
      --inputbox "Freie numerische Container-ID (100–999999):" 10 60 "${CTID}" 3>&1 1>&2 2>&3)"
    if validiere_pos_int "${eingabe_ctid}" 100 999999 && ctid_ist_frei "${eingabe_ctid}"; then
      CTID="${eingabe_ctid}"
      break
    fi
    whiptail --title "Ungültige Container-ID" --msgbox "CTID '${eingabe_ctid}' ist ungültig oder bereits belegt." 8 56
  done

  while true; do
    local eingabe_hn
    eingabe_hn="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Hostname" \
      --inputbox "Container-Hostname (Kleinbuchstaben, Ziffern, Bindestrich):" 10 60 "${HOSTNAME_CT}" 3>&1 1>&2 2>&3)"
    if validiere_hostname "${eingabe_hn}"; then
      HOSTNAME_CT="${eingabe_hn}"
      break
    fi
    whiptail --title "Ungültiger Hostname" --msgbox "Bitte einen gültigen RFC-1123-Hostnamen eingeben." 8 56
  done

  local eingabe_disk eingabe_cpu eingabe_ram
  eingabe_disk="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Disk-Größe" \
    --inputbox "Root-Disk-Größe in GB (mind. 4):" 10 60 "${DISK_SIZE}" 3>&1 1>&2 2>&3)"
  validiere_pos_int "${eingabe_disk}" 4 2048 || abbruch "Ungültige Disk-Größe: ${eingabe_disk}"
  DISK_SIZE="${eingabe_disk}"

  eingabe_cpu="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "CPU-Kerne" \
    --inputbox "Anzahl vCPU-Kerne:" 10 60 "${CORE_COUNT}" 3>&1 1>&2 2>&3)"
  validiere_pos_int "${eingabe_cpu}" 1 64 || abbruch "Ungültige Kernanzahl: ${eingabe_cpu}"
  CORE_COUNT="${eingabe_cpu}"

  eingabe_ram="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Arbeitsspeicher" \
    --inputbox "RAM in MiB (mind. 768 für Vite-PWA-Build):" 10 60 "${RAM_SIZE}" 3>&1 1>&2 2>&3)"
  validiere_pos_int "${eingabe_ram}" 768 65536 || abbruch "Ungültige RAM-Größe: ${eingabe_ram}"
  RAM_SIZE="${eingabe_ram}"

  BRIDGE="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Netzwerk-Bridge" \
    --inputbox "Proxmox-Bridge:" 10 60 "${BRIDGE}" 3>&1 1>&2 2>&3)"

  local net_modus
  net_modus="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "IPv4-Konfiguration" \
    --menu "Adressvergabe wählen:" 12 64 2 \
    "dhcp" "Automatisch per DHCP" \
    "static" "Statische IPv4-Adresse (CIDR + Gateway)" \
    3>&1 1>&2 2>&3)"
  if [[ "${net_modus}" == "static" ]]; then
    NET_IP="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Statische IPv4" \
      --inputbox "IPv4-Adresse im CIDR-Format (z. B. 192.168.178.50/24):" 10 64 "192.168.178.50/24" 3>&1 1>&2 2>&3)"
    validiere_cidr "${NET_IP}" || abbruch "Ungültige CIDR-Adresse: ${NET_IP}"

    GATEWAY="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "Standard-Gateway" \
      --inputbox "IPv4-Gateway (z. B. 192.168.178.1):" 10 64 "192.168.178.1" 3>&1 1>&2 2>&3)"
    validiere_ipv4 "${GATEWAY}" || abbruch "Ungültige Gateway-IP: ${GATEWAY}"
  else
    NET_IP="dhcp"
    GATEWAY=""
  fi

  VLAN_TAG="$(whiptail --backtitle "${APP_NAME} LXC Setup" --title "VLAN-Tag (optional)" \
    --inputbox "VLAN-ID (leer lassen für kein VLAN):" 10 60 "${VLAN_TAG}" 3>&1 1>&2 2>&3)"
  if [[ -n "${VLAN_TAG}" ]]; then
    validiere_pos_int "${VLAN_TAG}" 1 4094 || abbruch "Ungültiges VLAN-Tag: ${VLAN_TAG}"
  fi

  if whiptail --backtitle "${APP_NAME} LXC Setup" --title "Forward-Auth (Pangolin / Reverse-Proxy)" \
    --yesno "Soll das Backend vertrauenswürdige Forward-Auth-Header (X-Forwarded-User / X-Forwarded-Email) eines vorgeschalteten Reverse-Proxys (z. B. Pangolin) auswerten?\n\nJa = Betrieb hinter Reverse-Proxy\nNein = Reiner ungeschützter Direktzugriff im LAN" 14 70; then
    FORWARD_AUTH_ENABLED="true"
  else
    FORWARD_AUTH_ENABLED="false"
  fi
}

pruefe_debian13_host_kompatibilitaet() {
  [[ "${OS_DISTRO}" == "debian" && "${OS_VERSION}" == "13" ]] || return 0

  local debian_pm="${EQUIBUDGET_DEBIAN_PM_PATH:-/usr/share/perl5/PVE/LXC/Setup/Debian.pm}"
  [[ -f "${debian_pm}" ]] || return 0

  # Ältere pve-container-Versionen auf PVE 8 prüfen '$version <= 13' (lehnt 13.1/13.2 beim Start ab)
  if grep -Eq '\$version\s*(<=\s*1[23]\b|<\s*13\b)' "${debian_pm}"; then
    warn "Veraltetes 'pve-container'-Paket erkannt (${debian_pm} lehnt Debian-13-Point-Releases wie 13.1 beim Container-Start ab)."
    warn "Host-Fix für Debian 13: apt update && apt install --only-upgrade pve-container"

    if [[ "${NONINTERACTIVE}" != "1" ]] && command -v whiptail >/dev/null 2>&1; then
      if whiptail --backtitle "${APP_NAME} LXC Setup" \
        --title "Hinweis: Proxmox pve-container veraltet für Debian 13.x" \
        --yesno "Dein Proxmox-Host nutzt noch eine ältere Version von 'pve-container', die Debian 13.x beim Start ablehnt.\n\nSoll stattdessen direkt mit Ubuntu 24.04 LTS fortgefahren werden?\n\n(Bei 'Nein' wird abgebrochen, damit du zuerst 'apt update && apt install --only-upgrade pve-container' auf dem Host ausführen kannst.)" 16 74; then
        OS_DISTRO="ubuntu"
        OS_VERSION="24.04"
        info "Wechsle auf Basis-Template Ubuntu 24.04 LTS."
      else
        abbruch "Abgebrochen. Bitte aktualisiere 'pve-container' auf dem Proxmox-Host und starte das Skript erneut."
      fi
    else
      warn "Nicht-interaktiver Modus: Wechsle automatisch auf Ubuntu 24.04 LTS."
      OS_DISTRO="ubuntu"
      OS_VERSION="24.04"
    fi
  fi
}

ermittle_lxc_template() {
  local tmpl_storage="$1"
  local praefix="${OS_DISTRO}-${OS_VERSION}-standard_"
  local arch_muster="_${HOST_ARCH}\\.tar\\."

  info "Aktualisiere Proxmox-Template-Katalog..."
  pveam update >/dev/null 2>&1 || warn "pveam update meldete eine Warnung – fahre mit lokalem Katalog fort."

  local gefunden=""
  gefunden="$(pveam available -section system 2>/dev/null | awk -v p="${praefix}" -v a="${arch_muster}" '$2 ~ "^"p && $2 ~ a {print $2}' | sort -V | tail -n1)"

  if [[ -z "${gefunden}" && "${OS_DISTRO}" == "debian" && "${OS_VERSION}" == "13" ]]; then
    warn "Template '${praefix}*_${HOST_ARCH}' auf diesem Proxmox-Host nicht im Katalog gefunden – wechsle auf Ubuntu 24.04 LTS."
    OS_DISTRO="ubuntu"
    OS_VERSION="24.04"
    praefix="ubuntu-24.04-standard_"
    gefunden="$(pveam available -section system 2>/dev/null | awk -v p="${praefix}" -v a="${arch_muster}" '$2 ~ "^"p && $2 ~ a {print $2}' | sort -V | tail -n1)"
  fi

  [[ -n "${gefunden}" ]] || abbruch "Kein passendes Standard-Template (${praefix}*_${HOST_ARCH}.tar.*) über 'pveam available' gefunden."

  if ! pveam list "${tmpl_storage}" 2>/dev/null | awk '{print $1}' | grep -Fq "${gefunden}"; then
    info "Lade LXC-Template '${gefunden}' auf Storage '${tmpl_storage}' herunter..."
    pveam download "${tmpl_storage}" "${gefunden}"
  else
    ok "LXC-Template '${gefunden}' ist bereits lokal auf '${tmpl_storage}' vorhanden."
  fi

  TEMPLATE_DATEI="${gefunden}"
}

starte_container_mit_diagnose() {
  local id="$1"
  if pct start "${id}"; then
    return 0
  fi

  local debug_log="/tmp/equibudget-lxc-${id}-debug.log"
  warn "Erster Startversuch für Container ${id} fehlgeschlagen – führe Diagnose ('pct start ${id} --debug') aus..."
  pct start "${id}" --debug >"${debug_log}" 2>&1 || true

  if [[ -s "${debug_log}" ]]; then
    err "--- Diagnose-Auszug (pct start ${id} --debug) ---"
    grep -Ei 'error|failed|unsupported|denied|hook|conf|invalid|die' "${debug_log}" | tail -n 25 >&2 \
      || tail -n 25 "${debug_log}" >&2
    err "--- Vollständiges Debug-Log gespeichert unter: ${debug_log} ---"
  fi
  return 1
}

warte_auf_container_netzwerk() {
  local id="$1" versuche=30
  info "Warte auf Netzwerk-Initialisierung im Container ${id}..."
  for (( i=1; i<=versuche; i++ )); do
    if pct exec "${id}" -- ip -4 addr show dev eth0 2>/dev/null | grep -Eq 'inet [0-9]+\.'; then
      ok "Container-Netzwerk ist bereit."
      return 0
    fi
    sleep 1
  done
  abbruch "Zeitüberschreitung: Container ${id} hat innerhalb von ${versuche}s keine IPv4-Adresse erhalten."
}

uebertrage_skript_in_container() {
  local id="$1"
  local quell_datei=""

  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    quell_datei="${BASH_SOURCE[0]}"
  else
    TEMP_SCRIPT_FILE="$(mktemp /tmp/equibudget-installer.XXXXXX.sh)"
    info "Lade Installationsskript für Übergabe in den Container..."
    curl -fsSL "${RAW_SCRIPT_URL}" -o "${TEMP_SCRIPT_FILE}"
    [[ -s "${TEMP_SCRIPT_FILE}" ]] || abbruch "Heruntergeladenes Skript von ${RAW_SCRIPT_URL} ist leer."
    quell_datei="${TEMP_SCRIPT_FILE}"
  fi

  pct push "${id}" "${quell_datei}" /usr/local/bin/equibudget --perms 0755
  pct exec "${id}" -- ln -sf /usr/local/bin/equibudget /usr/local/bin/update
}

starte_host_installation() {
  pruefe_proxmox_umgebung

  if [[ -z "${CTID}" ]]; then
    CTID="$(pvesh get /cluster/nextid)"
  fi
  if [[ -f /etc/timezone && -z "${TZ:-}" ]]; then
    local host_tz
    host_tz="$(tr -d '[:space:]' < /etc/timezone)"
    [[ -n "${host_tz}" ]] && TZ_VALUE="${host_tz}"
  fi

  if [[ "${NONINTERACTIVE}" != "1" ]]; then
    command -v whiptail >/dev/null 2>&1 || abbruch "'whiptail' ist nicht installiert."

    whiptail --backtitle "Proxmox VE Community-Style Installer — ${APP_NAME}" \
      --title "${APP_NAME} LXC-Installation" \
      --yesno "Es wird ein schlanker, unprivilegierter LXC-Container für ${APP_NAME} erstellt.\n\nQuelle: ${REPO_URL}\nStandard-OS: Debian 13 (Trixie)\n\nFortfahren?" 13 70 || exit 0

    local modus
    modus="$(whiptail --backtitle "Proxmox VE Community-Style Installer — ${APP_NAME}" \
      --title "Installationsmodus" \
      --menu "Konfigurationsart wählen:" 12 70 2 \
      "default" "Standard (Debian 13, Unprivileged, 2 vCPU, 1024 MB RAM, 6 GB, DHCP)" \
      "advanced" "Erweitert (CTID, IP, VLAN, Ressourcen, OS & Forward-Auth anpassen)" \
      3>&1 1>&2 2>&3)" || exit 0

    if [[ "${modus}" == "advanced" ]]; then
      dialog_erweiterte_einstellungen
    fi
  else
    ctid_ist_frei "${CTID}" || abbruch "CTID '${CTID}' ist bereits vergeben."
  fi

  pruefe_debian13_host_kompatibilitaet

  local tmpl_storage ct_storage
  tmpl_storage="$(waehle_storage "vztmpl" "Template-Storage" "${TEMPLATE_STORAGE:-}")"
  ct_storage="$(waehle_storage "rootdir" "Container-Root-Storage" "${CONTAINER_STORAGE:-}")"

  ermittle_lxc_template "${tmpl_storage}"

  local net_spec="name=eth0,bridge=${BRIDGE}"
  if [[ "${NET_IP}" == "dhcp" ]]; then
    net_spec+=",ip=dhcp"
  else
    net_spec+=",ip=${NET_IP},gw=${GATEWAY}"
  fi
  [[ -n "${VLAN_TAG}" ]] && net_spec+=",tag=${VLAN_TAG}"

  local ct_features="nesting=1"
  if [[ "${CT_UNPRIVILEGED}" == "1" ]]; then
    ct_features="keyctl=1,nesting=1"
  fi

  trap 'fehler_rollback_host "$LINENO" "$BASH_COMMAND"' ERR

  info "Erstelle LXC-Container ${CTID} (${HOSTNAME_CT}, ${OS_DISTRO} ${OS_VERSION})..."
  pct create "${CTID}" "${tmpl_storage}:vztmpl/${TEMPLATE_DATEI}" \
    --arch "${HOST_ARCH}" \
    --ostype "${OS_DISTRO}" \
    --hostname "${HOSTNAME_CT}" \
    --unprivileged "${CT_UNPRIVILEGED}" \
    --features "${ct_features}" \
    --cores "${CORE_COUNT}" \
    --memory "${RAM_SIZE}" \
    --swap "${SWAP_SIZE}" \
    --rootfs "${ct_storage}:${DISK_SIZE}" \
    --net0 "${net_spec}" \
    --onboot 1

  CONTAINER_CREATED=1
  ok "Container ${CTID} erfolgreich angelegt."

  info "Starte Container ${CTID}..."
  starte_container_mit_diagnose "${CTID}"
  warte_auf_container_netzwerk "${CTID}"

  info "Übertrage Installer in Container ${CTID} und starte Anwendungs-Setup..."
  uebertrage_skript_in_container "${CTID}"

  pct exec "${CTID}" -- env \
    EQUIBUDGET_REPO_URL="${REPO_URL}" \
    EQUIBUDGET_REPO_BRANCH="${REPO_BRANCH}" \
    FORWARD_AUTH_ENABLED="${FORWARD_AUTH_ENABLED}" \
    TZ="${TZ_VALUE}" \
    /usr/local/bin/equibudget --install-guest

  # Nach erfolgreichem Abschluss Rollback deaktivieren
  CONTAINER_CREATED=0
  trap - ERR

  local ct_ip
  ct_ip="$(pct exec "${CTID}" -- hostname -I 2>/dev/null | awk '{print $1}')"

  pct set "${CTID}" -description "<div align='center'>
  <h2>EquiBudget — Haushalts-ERP</h2>
  <p><b>Web-Oberfläche:</b> <a href='http://${ct_ip}' target='_blank'>http://${ct_ip}</a></p>
  <p><b>Update im Container:</b> <code>update</code> bzw. <code>equibudget update</code></p>
  <p><a href='https://github.com/moritztw/EquiBudget' target='_blank'>GitHub Repository</a></p>
</div>" >/dev/null

  printf "\n======================================================================\n"
  ok "${APP_NAME} wurde erfolgreich in LXC ${CTID} (${HOSTNAME_CT}) installiert!"
  info "Web-Oberfläche & Setup-Assistent:  http://${ct_ip}"
  info "Konfiguration im Container:        ${ENV_FILE}"
  info "Updates künftig in der LXC-Shell:  update"
  printf "======================================================================\n"
}

# ==============================================================================
# TEIL 2: GAST-INSTALLATION & UPDATE IM LXC-CONTAINER
# ==============================================================================
konfiguriere_basis_system() {
  export DEBIAN_FRONTEND=noninteractive
  info "Aktualisiere Paketquellen und installiere Systempakete..."
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    locales \
    nginx \
    openssl \
    postgresql \
    postgresql-contrib \
    python3 \
    python3-pip \
    python3-venv

  # UTF-8 Locales aktivieren
  sed -i 's/^# *\(de_DE.UTF-8 UTF-8\)/\1/' /etc/locale.gen || true
  sed -i 's/^# *\(en_US.UTF-8 UTF-8\)/\1/' /etc/locale.gen || true
  locale-gen >/dev/null
  update-locale LANG=en_US.UTF-8

  if [[ -n "${TZ_VALUE}" && -f "/usr/share/zoneinfo/${TZ_VALUE}" ]]; then
    ln -sf "/usr/share/zoneinfo/${TZ_VALUE}" /etc/localtime
    printf '%s\n' "${TZ_VALUE}" > /etc/timezone
  fi
}

installiere_nodejs_22() {
  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -v | sed 's/^v//' | cut -d'.' -f1)"
    if validiere_pos_int "${node_major}" 20 99; then
      ok "Node.js $(node -v) bereits installiert."
      return 0
    fi
  fi

  info "Richte offizielles NodeSource-Repository für Node.js 22 LTS ein..."
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update -qq
  apt-get install -y -qq --no-install-recommends nodejs
  ok "Node.js $(node -v) installiert."
}

richte_systemnutzer_ein() {
  if ! id -u "${SYSTEM_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "${APP_ROOT}" --shell /usr/sbin/nologin "${SYSTEM_USER}"
  fi
  install -d -m 0755 -o "${SYSTEM_USER}" -g "${SYSTEM_USER}" "${APP_ROOT}"
  install -d -m 0750 -o root -g "${SYSTEM_USER}" "${CONFIG_DIR}"
  install -d -m 0750 -o root -g root "${BACKUP_DIR}"
}

richte_postgresql_und_env_ein() {
  systemctl enable --now postgresql

  if [[ -f "${ENV_FILE}" ]]; then
    ok "Bestehende Konfiguration ${ENV_FILE} bleibt erhalten."
    return 0
  fi

  info "Erzeuge Datenbank-Zugangsdaten und JWT-Secret..."
  local db_pass jwt_secret
  db_pass="$(openssl rand -hex 24)"
  jwt_secret="$(openssl rand -hex 32)"

  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v db_pass="${db_pass}" <<'SQL' >/dev/null
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'equibudget') THEN
    CREATE ROLE equibudget LOGIN;
  END IF;
END
$$;
ALTER ROLE equibudget WITH PASSWORD :'db_pass';
SQL

  if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='equibudget'" | grep -q 1; then
    runuser -u postgres -- createdb -O equibudget -E UTF8 equibudget
  fi

  cat > "${ENV_FILE}" <<EOF
EQUIBUDGET_ENVIRONMENT=production
EQUIBUDGET_DATABASE_URL=postgresql+asyncpg://equibudget:${db_pass}@127.0.0.1:5432/equibudget
EQUIBUDGET_JWT_SECRET_KEY=${jwt_secret}
EQUIBUDGET_JWT_ALGORITHM=HS256
EQUIBUDGET_JWT_ACCESS_TOKEN_EXPIRE_MINUTES=480
EQUIBUDGET_FORWARD_AUTH_ENABLED=${FORWARD_AUTH_ENABLED}
EQUIBUDGET_FORWARD_AUTH_USER_HEADER=X-Forwarded-User
EQUIBUDGET_FORWARD_AUTH_EMAIL_HEADER=X-Forwarded-Email
EQUIBUDGET_WEB_CONCURRENCY=2
EOF

  chown root:"${SYSTEM_USER}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
  ok "PostgreSQL-Datenbank und ${ENV_FILE} initialisiert."
}

baue_backend_und_migriere() {
  info "Installiere Python-Backend in ${VENV_DIR}..."
  if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    python3 -m venv "${VENV_DIR}"
  fi

  "${VENV_DIR}/bin/pip" install --quiet --upgrade pip
  "${VENV_DIR}/bin/pip" install --quiet --no-cache-dir "${REPO_DIR}/household-budget-backend"
  chown -R "${SYSTEM_USER}:${SYSTEM_USER}" "${APP_ROOT}"

  info "Führe Alembic-Datenbankmigrationen aus..."
  runuser -u "${SYSTEM_USER}" -- bash -c "
    set -a
    source '${ENV_FILE}'
    set +a
    cd '${REPO_DIR}/household-budget-backend'
    '${VENV_DIR}/bin/alembic' upgrade head
  "
  ok "Datenbankschema ist auf dem aktuellen Stand."
}

baue_frontend_pwa() {
  info "Kompiliere React-19-PWA-Frontend..."
  pushd "${REPO_DIR}" >/dev/null
  if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund --silent
  else
    npm install --no-audit --no-fund --silent
  fi
  VITE_API_BASE_URL=/api/v1 npm run build

  local staging_dir="${WEB_ROOT}.neu"
  rm -rf "${staging_dir}"
  install -d -m 0755 "${staging_dir}"
  cp -a "${REPO_DIR}/dist/." "${staging_dir}/"
  rm -rf "${WEB_ROOT}"
  mv "${staging_dir}" "${WEB_ROOT}"
  chown -R www-data:www-data "${WEB_ROOT}"

  # Build-Artefakte bereinigen, um Container-Speicherplatz schlank zu halten
  rm -rf "${REPO_DIR}/node_modules" "${REPO_DIR}/dist"
  npm cache clean --force >/dev/null 2>&1 || true
  popd >/dev/null
  ok "PWA-Frontend bereitgestellt unter ${WEB_ROOT}."
}

schreibe_systemd_und_nginx() {
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=EquiBudget FastAPI Backend
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${SYSTEM_USER}
Group=${SYSTEM_USER}
WorkingDirectory=${REPO_DIR}/household-budget-backend
Environment="PYTHONDONTWRITEBYTECODE=1"
EnvironmentFile=${ENV_FILE}
ExecStartPre=${VENV_DIR}/bin/alembic upgrade head
ExecStart=${VENV_DIR}/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/nginx/sites-available/equibudget <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${WEB_ROOT};
    index index.html;

    client_max_body_size 15m;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/manifest+json
        image/svg+xml;

    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-User \$http_x_forwarded_user;
        proxy_set_header X-Forwarded-Email \$http_x_forwarded_email;
        proxy_set_header X-Forwarded-Groups \$http_x_forwarded_groups;
        proxy_set_header X-Tenant-ID \$http_x_tenant_id;
        proxy_read_timeout 60s;
    }

    location /health/ {
        proxy_pass http://127.0.0.1:8000/health/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        access_log off;
    }

    location ~* ^/(sw\.js|workbox-.*\.js|manifest\.webmanifest|registerSW\.js|index\.html)\$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;
        try_files \$uri =404;
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files \$uri =404;
    }

    location / {
        add_header Cache-Control "no-cache" always;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

  rm -f /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/equibudget /etc/nginx/sites-enabled/equibudget
  nginx -t >/dev/null

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
  systemctl enable --now nginx
  systemctl reload nginx
}

pruefe_gesundheit() {
  info "Prüfe End-to-End-Bereitschaft (/health/ready)..."
  for (( i=1; i<=20; i++ )); do
    if curl -fsS http://127.0.0.1/health/ready >/dev/null 2>&1; then
      ok "EquiBudget antwortet fehlerfrei (Nginx -> FastAPI -> PostgreSQL)."
      return 0
    fi
    sleep 1
  done
  err "Backend-Readiness-Check fehlgeschlagen. Letzte Journal-Zeilen:"
  journalctl -u "${SERVICE_NAME}" -n 25 --no-pager >&2 || true
  exit 1
}

installiere_im_container() {
  ist_root
  konfiguriere_basis_system
  installiere_nodejs_22
  richte_systemnutzer_ein
  richte_postgresql_und_env_ein

  if [[ ! -d "${REPO_DIR}/.git" ]]; then
    info "Klone Repository ${REPO_URL} (Branch: ${REPO_BRANCH})..."
    rm -rf "${REPO_DIR}"
    git clone --depth 1 --branch "${REPO_BRANCH}" "${REPO_URL}" "${REPO_DIR}"
  else
    git -C "${REPO_DIR}" fetch --depth 1 origin "${REPO_BRANCH}"
    git -C "${REPO_DIR}" reset --hard "origin/${REPO_BRANCH}"
  fi

  baue_backend_und_migriere
  baue_frontend_pwa
  schreibe_systemd_und_nginx

  # Sicherstellen, dass das CLI-Werkzeug aus dem geklonten Stand aktuell verlinkt ist
  if [[ -f "${REPO_DIR}/deploy/proxmox/equibudget.sh" ]]; then
    install -m 0755 "${REPO_DIR}/deploy/proxmox/equibudget.sh" /usr/local/bin/equibudget
    ln -sf /usr/local/bin/equibudget /usr/local/bin/update
  fi

  apt-get clean
  pruefe_gesundheit
}

aktualisiere_im_container() {
  ist_root
  [[ -d "${REPO_DIR}/.git" ]] || abbruch "Keine bestehende EquiBudget-Installation unter ${REPO_DIR} gefunden."

  install -d -m 0750 "${BACKUP_DIR}"
  local zeitstempel backup_datei
  zeitstempel="$(date +%Y%m%d_%H%M%S)"
  backup_datei="${BACKUP_DIR}/equibudget_vor_update_${zeitstempel}.dump"

  info "Erstelle automatisches PostgreSQL-Sicherheitsbackup (${backup_datei})..."
  runuser -u postgres -- pg_dump -Fc equibudget > "${backup_datei}"
  chmod 0600 "${backup_datei}"
  # Nur die 5 neuesten Vorab-Backups aufbewahren
  ls -1t "${BACKUP_DIR}"/equibudget_vor_update_*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f
  ok "Datenbank-Backup gesichert."

  info "Lade aktuellen Stand von ${REPO_BRANCH} herunter..."
  git -C "${REPO_DIR}" fetch --depth 1 origin "${REPO_BRANCH}"
  git -C "${REPO_DIR}" reset --hard "origin/${REPO_BRANCH}"

  baue_backend_und_migriere
  baue_frontend_pwa

  if [[ -f "${REPO_DIR}/deploy/proxmox/equibudget.sh" ]]; then
    install -m 0755 "${REPO_DIR}/deploy/proxmox/equibudget.sh" /usr/local/bin/equibudget
    ln -sf /usr/local/bin/equibudget /usr/local/bin/update
  fi

  info "Starte Dienste neu..."
  systemctl restart "${SERVICE_NAME}"
  systemctl reload nginx
  pruefe_gesundheit
  ok "EquiBudget erfolgreich auf Commit $(git -C "${REPO_DIR}" rev-parse --short HEAD) aktualisiert."
}

zeige_status_im_container() {
  printf "=== EquiBudget Systemstatus ===\n"
  if [[ -d "${REPO_DIR}/.git" ]]; then
    printf "Installierter Commit: %s\n" "$(git -C "${REPO_DIR}" rev-parse --short HEAD)"
  fi
  systemctl --no-pager --full status postgresql "${SERVICE_NAME}" nginx | sed -n '1,24p' || true
  printf "\nReadiness (/health/ready): "
  if curl -fsS http://127.0.0.1/health/ready; then
    printf "\n"
  else
    printf "NICHT BEREIT\n"
    return 1
  fi
}

# ==============================================================================
# EINSTIEGSPUNKT
# ==============================================================================
hauptprogramm() {
  local aufruf_name
  aufruf_name="$(basename "${0:-equibudget}")"
  local aktion="${1:-}"

  if [[ "${aufruf_name}" == "update" && -z "${aktion}" ]]; then
    aktion="update"
  fi

  case "${aktion}" in
    -h|--help|help)
      zeige_hilfe
      ;;
    --install-guest)
      installiere_im_container
      ;;
    update|--update)
      aktualisiere_im_container
      ;;
    status|--status)
      zeige_status_im_container
      ;;
    "")
      if command -v pct >/dev/null 2>&1 && command -v pveversion >/dev/null 2>&1; then
        starte_host_installation
      elif [[ -d "${REPO_DIR}/.git" ]]; then
        aktualisiere_im_container
      else
        abbruch "Weder Proxmox-VE-Host ('pct') noch bestehende Installation erkannt. Siehe '--help'."
      fi
      ;;
    *)
      abbruch "Unbekannter Parameter '${aktion}'. Verwende '--help' für eine Übersicht."
      ;;
  esac
}

if [[ "${EQUIBUDGET_SOURCE_ONLY:-0}" != "1" ]]; then
  hauptprogramm "$@"
fi
