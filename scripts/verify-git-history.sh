#!/usr/bin/env bash
set -euo pipefail

patterns=(
  "SOP""_V3""_MATRIX"
  "OFFICIAL""_RULES""_DIGEST"
  "ADS""_PROMOTION""_SOP"
  "LEARNED""_FROM""_HISTORY""_SOP"
  "OPENAI""_API""_KEY"
  "MINELONA""_API""_KEY"
  "chat""/completions"
  "ruleTask""Generator"
  "01""_refresh""_metrics.sql"
  "02""_refresh""_classification.sql"
)

secret_labels=(
  "GitHub token"
  "model API key"
  "cloud access key"
  "private key block"
  "configured secret value"
  "database URL with password"
)

secret_patterns=(
  '(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}'
  '(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}([^A-Za-z0-9_-]|$)'
  '(AKIA|LTAI)[A-Z0-9]{12,}'
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
  '(PGPASSWORD|SESSION_SECRET|AI_API_KEY|MODEL_API_KEY)[[:space:]]*=[[:space:]]*[^[:space:]#]'
  'postgres(ql)?://[^:/[:space:]]+:[^@/[:space:]]+@'
)

failed=0
while IFS= read -r commit; do
  while IFS= read -r tracked_path; do
    if [[ "$tracked_path" =~ (^|/)(docs?|internal)(/|$) ]] \
      || [[ "$tracked_path" =~ (^|/)server/jobs(/|$) ]] \
      || [[ "$tracked_path" =~ (^|/)sql/seven-fields(/|$) ]] \
      || [[ "$tracked_path" =~ (^|/)[Rr][Ee][Aa][Dd][Mm][Ee]([.]|$) ]] \
      || [[ "$tracked_path" =~ [.]((md)|(doc)|(docx)|(pdf)|(map)|(pem)|(key)|(p12)|(pfx)|(crt))$ ]] \
      || { [[ "$tracked_path" =~ (^|/)[.]env([.]|$) ]] && [[ ! "$tracked_path" =~ [.]env[.]example$ ]]; }; then
      printf 'forbidden path in %s: %s\n' "$commit" "$tracked_path" >&2
      failed=1
    fi
  done < <(git ls-tree -r --name-only "$commit")

  for pattern in "${patterns[@]}"; do
    if git grep -n -I -F "$pattern" "$commit" -- . >/dev/null 2>&1; then
      printf 'protected marker in %s: %s\n' "$commit" "$pattern" >&2
      failed=1
    fi
  done

  for index in "${!secret_patterns[@]}"; do
    label="${secret_labels[$index]}"
    pattern="${secret_patterns[$index]}"
    if git grep -n -I -E -e "$pattern" "$commit" -- . >/dev/null 2>&1; then
      printf 'secret pattern in %s: %s\n' "$commit" "$label" >&2
      failed=1
    fi
  done
done < <(git rev-list --all)

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

printf 'git history boundary: pass\n'
