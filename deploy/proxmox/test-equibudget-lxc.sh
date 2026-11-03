#!/usr/bin/env bash
# ==============================================================================
# Automatisierte Tests für deploy/proxmox/equibudget.sh
# Prüft Syntax, Eingabevalidierungen, Debian-13-Provisionierung, Fallback & Rollback
# ==============================================================================

set -Eeuo pipefail

SKRIPT_PFAD="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/equibudget.sh"
FEHLER_ZAEHLER=0

ok_test()   { printf "  [BESTANDEN] %s\n" "$*"; }
fehl_test() { printf "  [FEHLER]    %s\n" "$*" >&2; FEHLER_ZAEHLER=$((FEHLER_ZAEHLER + 1)); }

erwarte_erfolg() {
  local beschreibung="$1"
  shift
  if "$@"; then
    ok_test "${beschreibung}"
  else
    fehl_test "${beschreibung}"
  fi
}

erwarte_fehler() {
  local beschreibung="$1"
  shift
  if "$@"; then
    fehl_test "${beschreibung} (hätte fehlschlagen müssen)"
  else
    ok_test "${beschreibung}"
  fi
}

printf "=== 1. Bash-Syntaxprüfung ===\n"
erwarte_erfolg "Syntax von equibudget.sh ist fehlerfrei" bash -n "${SKRIPT_PFAD}"
erwarte_erfolg "Hilfe-Ausgabe (--help) funktioniert" bash -c "'${SKRIPT_PFAD}' --help | grep -Fq 'EquiBudget — Proxmox VE LXC Installer'"

printf "\n=== 2. Unit-Tests der Validierungslogik ===\n"
# shellcheck source=/dev/null
EQUIBUDGET_SOURCE_ONLY=1 source "${SKRIPT_PFAD}"

erwarte_erfolg "validiere_pos_int akzeptiert 105 im Bereich 100..999" validiere_pos_int "105" 100 999
erwarte_fehler "validiere_pos_int lehnt Wert unter Minimum ab" validiere_pos_int "99" 100 999
erwarte_fehler "validiere_pos_int lehnt Nicht-Zahlen ab" validiere_pos_int "12a" 1 100

erwarte_erfolg "validiere_hostname akzeptiert 'equibudget-01'" validiere_hostname "equibudget-01"
erwarte_fehler "validiere_hostname lehnt führenden Bindestrich ab" validiere_hostname "-equibudget"
erwarte_fehler "validiere_hostname lehnt Großbuchstaben/Unterstrich ab" validiere_hostname "Equi_Budget"

erwarte_erfolg "validiere_ipv4 akzeptiert 192.168.178.1" validiere_ipv4 "192.168.178.1"
erwarte_fehler "validiere_ipv4 lehnt Oktett > 255 ab" validiere_ipv4 "192.168.178.256"
erwarte_fehler "validiere_ipv4 lehnt unvollständige IP ab" validiere_ipv4 "192.168.178"

erwarte_erfolg "validiere_cidr akzeptiert 192.168.178.50/24" validiere_cidr "192.168.178.50/24"
erwarte_fehler "validiere_cidr lehnt fehlendes Präfix ab" validiere_cidr "192.168.178.50"
erwarte_fehler "validiere_cidr lehnt Präfix > 32 ab" validiere_cidr "192.168.178.50/33"

printf "\n=== 3. Mock-Integrationstest: Proxmox-Host-Orchestrierung (Debian 13) ===\n"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "${TEST_TMP}"' EXIT
MOCK_BIN="${TEST_TMP}/bin"
LOG_DATEI="${TEST_TMP}/aufrufe.log"
mkdir -p "${MOCK_BIN}"
: > "${LOG_DATEI}"

cat > "${MOCK_BIN}/pveversion" <<'EOF'
#!/usr/bin/env bash
echo "pve-manager/8.3.2/3e76eec21c4a14a7 (running kernel: 6.8.12-5-pve)"
EOF

cat > "${MOCK_BIN}/dpkg" <<'EOF'
#!/usr/bin/env bash
echo "amd64"
EOF

cat > "${MOCK_BIN}/pvesh" <<'EOF'
#!/usr/bin/env bash
echo "105"
EOF

cat > "${MOCK_BIN}/qm" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF

cat > "${MOCK_BIN}/pvesm" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"vztmpl"* ]]; then
  printf "Name         Type     Status\nlocal        dir      active\n"
else
  printf "Name         Type     Status\nlocal-lvm    lvmthin  active\n"
fi
EOF

cat > "${MOCK_BIN}/pveam" <<EOF
#!/usr/bin/env bash
echo "pveam \$*" >> "${LOG_DATEI}"
case "\$1" in
  update) exit 0 ;;
  available)
    if [[ "\${MOCK_NO_DEBIAN13:-0}" == "1" ]]; then
      printf "system          ubuntu-24.04-standard_24.04-2_amd64.tar.zst\n"
    else
      printf "system          debian-13-standard_13.1-1_amd64.tar.zst\n"
      printf "system          ubuntu-24.04-standard_24.04-2_amd64.tar.zst\n"
    fi
    ;;
  list) exit 0 ;;
  download) exit 0 ;;
esac
EOF

cat > "${MOCK_BIN}/pct" <<EOF
#!/usr/bin/env bash
echo "pct \$*" >> "${LOG_DATEI}"
case "\$1" in
  status) exit 1 ;;
  create|push|set|stop|destroy) exit 0 ;;
  start)
    if [[ "\${MOCK_FAIL_START:-0}" == "1" ]]; then
      if [[ "\$*" == *"--debug"* ]]; then
        echo "lxc-start 105 ERROR lxc_conf - Script exited with status 25: unsupported debian version '13.1'"
      fi
      exit 1
    fi
    exit 0
    ;;
  exec)
    if [[ "\$*" == *"ip -4 addr"* ]]; then
      echo "    inet 192.168.178.105/24 brd 192.168.178.255 scope global eth0"
      exit 0
    fi
    if [[ "\$*" == *"hostname -I"* ]]; then
      echo "192.168.178.105"
      exit 0
    fi
    if [[ "\$*" == *"--install-guest"* && "\${MOCK_FAIL_GUEST:-0}" == "1" ]]; then
      exit 42
    fi
    exit 0
    ;;
esac
EOF

chmod +x "${MOCK_BIN}"/*
MODERN_DEBIAN_PM="${TEST_TMP}/Debian-modern.pm"
cat > "${MODERN_DEBIAN_PM}" <<'EOF'
die "unsupported debian version '$version'\n" if !($version >= 4 && $version < 15);
EOF

PATH="${MOCK_BIN}:${PATH}" \
  EQUIBUDGET_TEST_EUID=0 \
  EQUIBUDGET_DEBIAN_PM_PATH="${MODERN_DEBIAN_PM}" \
  NONINTERACTIVE=1 \
  bash "${SKRIPT_PFAD}" >/dev/null

erwarte_erfolg "Debian-13-Template wurde heruntergeladen" \
  grep -Fq "pveam download local debian-13-standard_13.1-1_amd64.tar.zst" "${LOG_DATEI}"

erwarte_erfolg "Unprivilegierter LXC 105 mit keyctl=1,nesting=1 erstellt" \
  grep -Fq "pct create 105 local:vztmpl/debian-13-standard_13.1-1_amd64.tar.zst --arch amd64 --ostype debian --hostname equibudget --unprivileged 1 --features keyctl=1,nesting=1 --cores 2 --memory 1024 --swap 512 --rootfs local-lvm:6 --net0 name=eth0,bridge=vmbr0,ip=dhcp --onboot 1" "${LOG_DATEI}"

erwarte_fehler "pct create übergibt kein fehleranfälliges --timezone Flag mehr" \
  grep -Fq -- "--timezone" "${LOG_DATEI}"

erwarte_erfolg "Gast-Installation (--install-guest) wurde im Container ausgelöst" \
  grep -Fq "/usr/local/bin/equibudget --install-guest" "${LOG_DATEI}"

erwarte_erfolg "Proxmox-Container-Notiz enthält ermittelte Container-IP" \
  grep -Fq "http://192.168.178.105" "${LOG_DATEI}"

printf "\n=== 4. Mock-Test: Privilegierter Container ohne keyctl=1 & veraltetes Debian.pm ===\n"
: > "${LOG_DATEI}"
ALTES_DEBIAN_PM="${TEST_TMP}/Debian-old.pm"
cat > "${ALTES_DEBIAN_PM}" <<'EOF'
die "unsupported debian version '$version'\n" if !($version >= 4 && $version <= 13);
EOF

PATH="${MOCK_BIN}:${PATH}" \
  EQUIBUDGET_TEST_EUID=0 \
  EQUIBUDGET_DEBIAN_PM_PATH="${ALTES_DEBIAN_PM}" \
  CT_UNPRIVILEGED=0 \
  NONINTERACTIVE=1 \
  bash "${SKRIPT_PFAD}" >/dev/null 2>&1

erwarte_erfolg "Veraltetes Debian.pm wechselt automatisch auf Ubuntu 24.04 LTS" \
  grep -Fq "pct create 105 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst" "${LOG_DATEI}"

erwarte_erfolg "Privilegierter Container nutzt '--features nesting=1' (ohne keyctl=1)" \
  grep -Fq -- "--unprivileged 0 --features nesting=1" "${LOG_DATEI}"

printf "\n=== 5. Mock-Test: Diagnose-Log & Rollback bei pct-start-Fehler ===\n"
: > "${LOG_DATEI}"
rm -f /tmp/equibudget-lxc-105-debug.log
STDERR_START="${TEST_TMP}/stderr_start.log"
if PATH="${MOCK_BIN}:${PATH}" \
  EQUIBUDGET_TEST_EUID=0 \
  EQUIBUDGET_DEBIAN_PM_PATH="${MODERN_DEBIAN_PM}" \
  NONINTERACTIVE=1 \
  MOCK_FAIL_START=1 \
  bash "${SKRIPT_PFAD}" >/dev/null 2>"${STDERR_START}"; then
  fehl_test "Fehlgeschlagener pct start hätte abbrechen müssen"
else
  ok_test "Fehlgeschlagener pct start bricht kontrolliert ab"
fi

erwarte_erfolg "Diagnose führt 'pct start 105 --debug' vor dem Rollback aus" \
  grep -Fq "pct start 105 --debug" "${LOG_DATEI}"

erwarte_erfolg "Konkrete Hook-Fehlermeldung wird im Terminal ausgegeben" \
  grep -Fq "unsupported debian version '13.1'" "${STDERR_START}"

erwarte_erfolg "Rollback zerstört Container genau einmal (--purge)" \
  test "$(grep -Fc 'pct destroy 105 --purge' "${LOG_DATEI}")" -eq 1
rm -f /tmp/equibudget-lxc-105-debug.log

printf "\n=== 6. Mock-Integrationstest: Rollback bei fehlerhafter Gast-Installation ===\n"
: > "${LOG_DATEI}"
if PATH="${MOCK_BIN}:${PATH}" \
  EQUIBUDGET_TEST_EUID=0 \
  EQUIBUDGET_DEBIAN_PM_PATH="${MODERN_DEBIAN_PM}" \
  NONINTERACTIVE=1 \
  MOCK_FAIL_GUEST=1 \
  bash "${SKRIPT_PFAD}" >/dev/null 2>&1; then
  fehl_test "Fehlerhafter Gast-Lauf hätte mit Exit-Code != 0 abbrechen müssen"
else
  ok_test "Fehlerhafter Gast-Lauf bricht kontrolliert ab"
fi

erwarte_erfolg "Rollback zerstört unvollständigen Container rückstandsfrei (--purge)" \
  grep -Fq "pct destroy 105 --purge" "${LOG_DATEI}"

printf "\n======================================================================\n"
if (( FEHLER_ZAEHLER == 0 )); then
  printf "ALLE TESTS ERFOLGREICH BESTANDEN.\n"
  exit 0
else
  printf "%d TEST(S) FEHLGESCHLAGEN.\n" "${FEHLER_ZAEHLER}" >&2
  exit 1
fi
