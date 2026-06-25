#!/usr/bin/env bash

set -u

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"
[ -n "$input" ] || exit 0

tool_name="$(jq -r '.tool_name // empty' <<<"$input" 2>/dev/null)"
[ "$tool_name" = "Bash" ] || exit 0

command_input="$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null)"
[ -n "$command_input" ] || exit 0

rewritten="$(bash "$HOME/.mev/rtk/rewrite.sh" "$command_input" 2>/dev/null)"
rewrite_exit=$?

if [ "$rewrite_exit" -ne 0 ] || [ -z "$rewritten" ]; then
	exit 0
fi

updated_input="$(jq -c --arg cmd "$rewritten" '.tool_input.command = $cmd | .tool_input' <<<"$input" 2>/dev/null)" || exit 0

jq -cn --argjson updated_input "$updated_input" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "RTK auto-rewrite",
    "updatedInput": $updated_input
  }
}'
