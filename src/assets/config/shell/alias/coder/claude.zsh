alias cld="claude"
alias cld-u="claude update"
alias cld-r="claude --resume"
alias cld-rm-c="claude remote-control"
alias cld-pg-ls="claude plugin list"
alias cld-pg-i="claude plugin install"
alias cld-pg-ui="claude plugin uninstall"
alias cld-pg-u="claude plugin update"

# Link AGENTS.md or README.md to .claude/CLAUDE.md
alias cld-ln=cld_ln
cld_ln() {
  local target_file="AGENTS.md"
  if [ ! -f "AGENTS.md" ]; then
    if [ -f "README.md" ]; then
      target_file="README.md"
    else
      echo "❌ Neither AGENTS.md nor README.md found in the project root. Please run this command from the repository root." >&2
      return 1
    fi
  fi

  # Ensure directory exists
  mkdir -p .claude

  # Create relative symlink (force overwrite)
  # Target: ../<target_file> (relative from .claude/CLAUDE.md)
  ln -sf "../${target_file}" .claude/CLAUDE.md

  echo "🔗 Linked .claude/CLAUDE.md -> ../${target_file}"
}

# The lone positional argument is a resume target, so a leading `-` marks the
# rest as claude flags and keeps the launcher on --continue.
cld_session() {
  local model="$1" effort="$2"
  shift 2
  if [[ -n "${1-}" && "$1" != -* ]]; then
    local session="$1"
    shift
    command claude --resume "$session" --model "$model" --effort "$effort" "$@"
  else
    command claude --continue --model "$model" --effort "$effort" "$@"
  fi
}

# cld-<model><effort> launchers over the full model x effort matrix.
#
# `ultracode` is absent from `claude --help` but the CLI accepts it as an
# --effort value and resolves it to xhigh plus the standing ultracode opt-in,
# which the deployed workflowKeywordTriggerEnabled=false makes otherwise
# unreachable at launch. `max` takes `mx` because `medium` already holds `m`.
_cld_define_launchers() {
  local -A model=(h haiku s sonnet o opus f fable)
  local -A effort=(l low m medium h high x xhigh u ultracode mx max)
  local m e
  for m in ${(k)model}; do
    for e in ${(k)effort}; do
      functions[cld-${m}${e}]="cld_session ${model[$m]} ${effort[$e]} \"\$@\""
    done
  done
}
_cld_define_launchers
unfunction _cld_define_launchers

# ~/.claude/projects/<cwd with non-alnum chars replaced by "-">/*.jsonl is the
# resumable-session store itself: mtime is last-activity order, each file's
# last `type:"last-prompt"` line is the latest prompt, `gitBranch` the branch
# at that point. `tac` is GNU-only and absent on macOS, so use `tail -r`.
cld-ls() {
  if ! command -v jq >/dev/null 2>&1; then
    print -u2 -- "cld-ls requires jq"
    return 127
  fi

  local n="${1:-10}"
  local proj_dir="$HOME/.claude/projects/${PWD//[^A-Za-z0-9]/-}"
  if [[ ! -d "$proj_dir" ]]; then
    print -u2 -- "No Claude Code sessions recorded for $PWD"
    return 1
  fi

  local -a files
  files=("$proj_dir"/*.jsonl(N.om))
  if (( ${#files} == 0 )); then
    print -u2 -- "No sessions found in $proj_dir"
    return 1
  fi

  local RESET=$'\e[0m' DIM=$'\e[2m' CYAN=$'\e[36m' YELLOW=$'\e[33m'
  local f id mtime_h branch prompt
  local i=0
  for f in "${files[@]}"; do
    (( i >= n )) && break
    id="${f:t:r}"
    mtime_h="$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$f" 2>/dev/null)"
    branch="$(tail -r "$f" 2>/dev/null | jq -rs 'map(select(.gitBranch != null)) | (first.gitBranch // "-")' 2>/dev/null)"
    prompt="$(tail -r "$f" 2>/dev/null | jq -rs 'map(select(.type=="last-prompt")) | (first.lastPrompt // "-")' 2>/dev/null)"
    prompt="${prompt//$'\n'/ }"
    prompt="${prompt:0:70}"
    printf '%s%s%s  %s%s%s  %s%-12s%s  %s\n' \
      "$CYAN" "$id" "$RESET" \
      "$DIM" "$mtime_h" "$RESET" \
      "$YELLOW" "$branch" "$RESET" \
      "$prompt"
    (( i++ ))
  done
}
