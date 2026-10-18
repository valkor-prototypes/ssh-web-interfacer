#!/usr/bin/env bash
# Prints warnings and alerts from the web terminal's log, oldest first,
# followed by a summary of the IPs with the most failed attempts.
#
#   usage: scripts/show-warnings.sh [options]
#     -a          show all events (INFO too), not just WARN/ALERT
#     -A          show only ALERT lines (likely brute force, host key mismatch)
#     -n N        only the last N matching lines
#     -s DATE     only events on/after DATE, in UTC (e.g. 2026-10-17 or 2026-10-17T15:00)
#     -f          keep following the log for new events (Ctrl-C to stop)
#     -h          this help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${LOG_DIR:-}" && -f "$ROOT/.env" ]]; then
  LOG_DIR="$(grep -E '^LOG_DIR=' "$ROOT/.env" | tail -1 | cut -d= -f2- || true)"
fi
LOG_DIR="${LOG_DIR:-logs}"
LOG_DIR="${LOG_DIR/#\~/$HOME}"
[[ "$LOG_DIR" = /* ]] || LOG_DIR="$ROOT/$LOG_DIR"
LOG_FILE="$LOG_DIR/server.log"

PATTERN=' (WARN |ALERT) '
LIMIT=''
SINCE=''
FOLLOW=0

while getopts 'aAn:s:fh' opt; do
  case "$opt" in
    a) PATTERN=' (INFO |WARN |ALERT) ' ;;
    A) PATTERN=' ALERT ' ;;
    n) LIMIT="$OPTARG" ;;
    s) SINCE="$OPTARG" ;;
    f) FOLLOW=1 ;;
    h) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) exit 1 ;;
  esac
done

if [[ -t 1 ]]; then
  RED=$'\e[1;31m' YELLOW=$'\e[33m' DIM=$'\e[2m' BOLD=$'\e[1m' RESET=$'\e[0m'
else
  RED='' YELLOW='' DIM='' BOLD='' RESET=''
fi

colorize() {
  sed -u -E \
    -e "s/^([^ ]+) (ALERT) (.*)$/${DIM}\1${RESET} ${RED}\2 \3${RESET}/" \
    -e "s/^([^ ]+) (WARN ) (.*)$/${DIM}\1${RESET} ${YELLOW}\2${RESET} \3/" \
    -e "s/^([^ ]+) (INFO ) (.*)$/${DIM}\1 \2${RESET} \3/"
}

# Oldest rotated file first, so output is chronological.
files=()
for i in 5 4 3 2 1; do [[ -f "$LOG_FILE.$i" ]] && files+=("$LOG_FILE.$i"); done
[[ -f "$LOG_FILE" ]] && files+=("$LOG_FILE")

if (( ${#files[@]} == 0 )); then
  echo "No log yet at $LOG_FILE (the server creates it on start)."
  exit 0
fi

matches() {
  cat "${files[@]}" \
    | grep -E -- "$PATTERN" \
    | awk -v since="$SINCE" 'since == "" || $1 >= since' \
    | { if [[ -n "$LIMIT" ]]; then tail -n "$LIMIT"; else cat; fi; }
}

output="$(matches || true)"
if [[ -z "$output" ]]; then
  echo "No matching events${SINCE:+ since $SINCE}. ✔"
else
  printf '%s\n' "$output" | colorize
fi

# Summary: failed/blocked attempts per IP, and alert count.
failures="$(cat "${files[@]}" | awk -v since="$SINCE" 'since == "" || $1 >= since' | grep -E ' (WARN |ALERT) ' || true)"
if [[ -n "$failures" ]]; then
  alerts="$(grep -c ' ALERT ' <<<"$failures" || true)"
  echo
  echo "${BOLD}Summary${SINCE:+ since $SINCE}${RESET}: $(wc -l <<<"$failures") warnings, ${RED}${alerts} alerts${RESET}"
  echo "${BOLD}Top IPs by warnings:${RESET}"
  # The logger always writes ip= as the first field, so take only the first
  # match (a client-supplied value later on the line can't fake an IP).
  awk 'match($0, / ip=[^ "]+/) { ip = substr($0, RSTART + 4, RLENGTH - 4); n[ip]++; last[ip] = $1 }
       END { for (ip in n) printf "%d %s %s\n", n[ip], ip, last[ip] }' <<<"$failures" \
    | sort -rn | head -10 \
    | while read -r count ip last; do
        printf '  %6d  %-40s last %s\n' "$count" "$ip" "$last"
      done
fi

if (( FOLLOW )); then
  echo
  echo "${DIM}Following $LOG_FILE (Ctrl-C to stop)…${RESET}"
  tail -n 0 -F "$LOG_FILE" | grep --line-buffered -E -- "$PATTERN" | colorize
fi
