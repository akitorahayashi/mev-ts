#!/usr/bin/env bash
set -u

input="$(cat)"

jq_get() {
	jq -r "$1 // empty" <<<"$input" 2>/dev/null
}

YELLOW=$'\033[33m'
BLUE=$'\033[34m'
ORANGE=$'\033[38;5;208m'
PURPLE=$'\033[38;5;141m'
GREEN=$'\033[32m'
RED=$'\033[31m'
RESET=$'\033[0m'

# Color a "used percentage" by threshold: <75 green, <90 yellow, else red.
color_used() {
	awk -v p="$1" -v g="$GREEN" -v y="$YELLOW" -v r="$RED" 'BEGIN {
    if (p == "") exit 1
    if (p < 75) printf "%s", g
    else if (p < 90) printf "%s", y
    else printf "%s", r
  }' 2>/dev/null
}

model="$(jq_get '.model.display_name // .model.id')"
dir="$(jq_get '.workspace.current_dir')"
[ -z "$dir" ] && dir="$(jq_get '.cwd')"

ctx_remaining="$(jq_get '.context_window.remaining_percentage')"
ctx_used="$(jq_get '.context_window.used_percentage')"

# Quota is reported as remaining_fraction per named bucket; show weekly buckets as used %.
gemini_remaining="$(jq_get '.quota["gemini-weekly"].remaining_fraction')"
third_party_remaining="$(jq_get '.quota["3p-weekly"].remaining_fraction')"

branch="-"
dirty=""
if [ -n "$dir" ] && git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	branch="$(git -C "$dir" branch --show-current 2>/dev/null)"
	[ -z "$branch" ] && branch="$(git -C "$dir" rev-parse --short HEAD 2>/dev/null)"

	staged="$(git -C "$dir" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
	modified="$(git -C "$dir" diff --name-only 2>/dev/null | wc -l | tr -d ' ')"
	untracked="$(git -C "$dir" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')"

	[ "${staged:-0}" -gt 0 ] && dirty="${dirty}+${staged}"
	[ "${modified:-0}" -gt 0 ] && dirty="${dirty}~${modified}"
	[ "${untracked:-0}" -gt 0 ] && dirty="${dirty}?${untracked}"
fi

ctx_text="--"
if [ -n "$ctx_remaining" ]; then
	ctx_text="${ctx_remaining%.*}% left"
elif [ -n "$ctx_used" ]; then
	ctx_text="${ctx_used%.*}% used"
fi

# Build a colored "<label> N%" segment from a remaining_fraction (1.0 = unused).
quota_segment() {
	local label="$1" frac="$2" pct col
	[ -z "$frac" ] && return 1
	pct="$(awk -v f="$frac" 'BEGIN { printf "%.0f", (1 - f) * 100 }' 2>/dev/null)" || return 1
	col="$(color_used "$pct")" || col="$RED"
	printf '%s%s %s%%%s' "$col" "$label" "$pct" "$RESET"
}

limit_text=""
seg="$(quota_segment gemini "$gemini_remaining")" && limit_text="$seg"
seg="$(quota_segment 3p "$third_party_remaining")" && limit_text="${limit_text:+$limit_text / }$seg"
[ -z "$limit_text" ] && limit_text="${RED}limit --${RESET}"

# Model display name embeds reasoning strength, e.g. "Gemini 3.5 Flash (Medium)".
effort=""
case "$model" in
*\(*\))
	effort="${model##*\(}"
	effort="effort:${effort%\)}"
	;;
esac
model_name="${model%% (*}"

model_part="${YELLOW}${model_name:-model?}${RESET}"
ctx_part="${ORANGE}ctx ${ctx_text}${RESET}"
branch_part="${BLUE}${branch}${dirty:+ [$dirty]}${RESET}"

echo "${model_part} | ${ctx_part} | ${branch_part}"
echo "${PURPLE}${effort:-effort:default}${RESET} | ${limit_text}"
