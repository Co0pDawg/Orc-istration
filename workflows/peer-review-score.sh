#!/usr/bin/env bash
# Size a PR diff and pick its review tier (workflows/peer-review.md).
# Usage: bash peer-review-score.sh <base-ref> <head-ref> [sensitive-path-regex]
#   e.g. bash peer-review-score.sh origin/main origin/feature/42-export 'Payment|/Admin/|Auth'
# The regex is the "Sensitive paths:" line of the repo's review rules (extended regex, case-insensitive); none by default.
# Prints: product/test/docs line counts, score, size tier, then one "risk: <path>" line per sensitive path hit.
set -euo pipefail
base=${1:?base ref}; head=${2:?head ref}; sensitive=${3:-}
tests='(^|/)(tests?|__tests__|spec)/|\.Tests?/|[._-](test|spec)\.[^/]+$|_test\.[^/]+$'
docs='(^|/)docs/|\.md$'

# Generated and vendored files never count.
git diff --numstat -M "$base...$head" -- . \
  ':!*package-lock.json' ':!*.lock' ':!*.min.*' ':!*.Designer.cs' ':!**/vendor/**' ':!**/node_modules/**' |
TESTS=$tests DOCS=$docs awk '
  $1 == "-" { next }                                  # binary
  { n = $1 + $2; f = $3 }
  f ~ ENVIRON["TESTS"] { t += n; next }          # from ENVIRON, not -v: -v would eat the backslashes
  f ~ ENVIRON["DOCS"]  { d += n; next }
  { p += n }
  END {
    td = int((t + d) / 4); if (td > 1000) td = 1000
    s = p + td                                        # ponytail: tests/docs weigh 1/4, capped at 1000; retune from cost-log scores
    tier = s <= 100 ? "S" : s <= 400 ? "M" : s <= 1500 ? "L" : "XL"
    printf "product=%d tests=%d docs=%d score=%d size_tier=%s\n", p, t, d, s, tier
  }'

# Sensitive paths bump one tier. Names only; the caller does the bump.
[ -z "$sensitive" ] && exit 0
git diff --name-only "$base...$head" | grep -E -v "$tests|$docs" | grep -E -i "$sensitive" | sed 's/^/risk: /' || true
