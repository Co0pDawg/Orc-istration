#!/usr/bin/env bash
# Size a PR diff and pick its review tier.
# Usage: bash score.sh <base-ref> <head-ref>   (e.g. origin/develop origin/task/PET-123)
# Prints: product/test/docs line counts, score, size tier, risk hits, final tier.
set -euo pipefail
base=${1:?base ref}; head=${2:?head ref}

# Generated/vendored files never count.
git diff --numstat -M "$base...$head" -- . \
  ':!*.dacpac' ':!*package-lock.json' ':!*.Designer.cs' ':!*.min.*' \
  ':!**/wwwroot/lib/**' ':!**/Migrations/*ModelSnapshot.cs' |
awk '
  $1 == "-" { next }                                  # binary
  { n = $1 + $2; f = $3 }
  f ~ /(\.Tests?\/|^UITests\/)/      { t += n; next } # test projects
  f ~ /(^docs\/|\.md$)/              { d += n; next } # docs, annotation files
  { p += n }
  END {
    td = int((t + d) / 4); if (td > 1000) td = 1000
    s = p + td                                        # ponytail: tests/docs weigh 1/4, capped at 1000; retune from cost-log scores
    tier = s <= 100 ? "S" : s <= 400 ? "M" : s <= 1500 ? "L" : "XL"
    printf "product=%d tests=%d docs=%d score=%d size_tier=%s\n", p, t, d, s, tier
  }'

# Risk areas bump one tier. Names only; the caller does the bump.
git diff --name-only "$base...$head" | grep -E -v '(\.Tests?/|^UITests/|^docs/|\.md$)' | grep -E -i \
  'PaymentGateway|/Areas/Admin/|Mfa|AdminsAttribute|EmployeesAttribute|Authentication|KennelManagementSystem\.Schema/|KmsDbTool/Up|accounts\.|Subscription.*Payment' \
  | sed 's/^/risk: /' || true
