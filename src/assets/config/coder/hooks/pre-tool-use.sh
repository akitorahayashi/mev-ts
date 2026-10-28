#!/usr/bin/env bash

set -u

if [ "$#" -ne 1 ] || [[ "$1" != claude && "$1" != codex ]]; then
	printf 'Usage: %s <claude|codex>\n' "$0" >&2
	exit 64
fi
client="$1"

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

# Claude Code refuses a git command launched through rtk in a session isolated
# in a linked worktree, because it cannot see which worktree that git targets.
# The command runs uncompressed there instead.
if [ "$client" = claude ]; then
	case "$rewritten" in
	*"rtk git"*)
		cwd="$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)"
		if [ -n "$cwd" ]; then
			git_dir="$(git -C "$cwd" rev-parse --path-format=absolute --git-dir 2>/dev/null)"
			common_dir="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
			if [ -n "$git_dir" ] && [ "$git_dir" != "$common_dir" ]; then
				exit 0
			fi
		fi
		;;
	esac
fi

updated_input="$(jq -c --arg cmd "$rewritten" '.tool_input.command = $cmd | .tool_input' <<<"$input" 2>/dev/null)" || exit 0

jq -cn --arg client "$client" --argjson updated_input "$updated_input" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "updatedInput": $updated_input
  }
} | if $client == "codex" then
  .hookSpecificOutput.permissionDecision = "allow"
else
  .
end'
