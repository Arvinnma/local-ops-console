#!/bin/zsh
set -euo pipefail

PROMPT="${1:-}"
HELPER="${LOCAL_OPS_KEYCHAIN_HELPER:-}"
ACCOUNT="${LOCAL_OPS_KEYCHAIN_ACCOUNT:-}"

# Never answer account-password, host-key confirmation, or other SSH prompts.
if [[ "$PROMPT" != *passphrase* && "$PROMPT" != *Passphrase* ]]; then
  exit 1
fi

[[ -n "$HELPER" && -x "$HELPER" && -n "$ACCOUNT" ]] || exit 1
exec "$HELPER" get "$ACCOUNT"
