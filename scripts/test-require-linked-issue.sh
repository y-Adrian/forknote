#!/usr/bin/env bash
# Dry-run for Require Linked Issue extraction rules (no GitHub API).
# Exit 0 if all assertions pass.
set -euo pipefail

CLAUSE_RE='(close[sd]?|fix(e[sd])?|resolve[sd]?|related([[:space:]]+issues?)?)[[:space:]]*:?[[:space:]]*#[0-9]+([[:space:]]*([,&]|and)[[:space:]]*#[0-9]+)*'

extract_nums() {
  local text="$1"
  local pr_number="${2:-}"
  local out=""
  local clause num
  while IFS= read -r clause; do
    [ -z "$clause" ] && continue
    while IFS= read -r num; do
      [ -z "$num" ] && continue
      if [ -n "$pr_number" ] && [ "$num" = "$pr_number" ]; then
        continue
      fi
      out="${out}${num}"$'\n'
    done < <(printf '%s' "$clause" | grep -Eo '#[0-9]+' | tr -d '#' || true)
  done < <(printf '%s' "$text" | grep -Eio "$CLAUSE_RE" || true)
  printf '%s' "$out" | awk 'NF' | sort -nu | paste -sd',' -
}

assert_eq() {
  local name="$1" got="$2" want="$3"
  if [ "$got" != "$want" ]; then
    echo "FAIL: ${name}: got='${got}' want='${want}'" >&2
    exit 1
  fi
  echo "OK: ${name}"
}

# PR #103-style prose must NOT yield candidates.
PR103='Follow-up to merged #102 / issue #101 (agent still mis-routed).'
assert_eq "bare historical #N ignored" "$(extract_nums "$PR103" 103)" ""

# Explicit forms accepted.
assert_eq "Related Issue" "$(extract_nums 'Related Issue: #105' 200)" "105"
assert_eq "Fixes" "$(extract_nums 'Fixes #42' 200)" "42"
assert_eq "Closes list" "$(extract_nums 'Closes #1, #2 and #3' 200)" "1,2,3"
assert_eq "Resolves" "$(extract_nums 'This Resolves #9 for now' 200)" "9"

# Self-ref rejected at extract time when PR number provided.
assert_eq "self PR number skipped" "$(extract_nums 'Fixes #103' 103)" ""

# Mixed: keyword link + bare mention — only keyword counts.
MIXED=$'Related Issue: #105\nFollow-up to merged #102 / issue #101'
assert_eq "keyword wins over bare" "$(extract_nums "$MIXED" 200)" "105"

echo "All require-linked-issue dry-run assertions passed."
