# shellcheck disable=SC2139
# Define development aliases for commands

# zip project directory
# Usage: zpd [output_filename]
zpd() (
  local root
  root="$(git rev-parse --show-toplevel)" || exit 1

  local dir
  dir="$(basename "$root")"

  local out
  if [ -n "$1" ]; then
    out="${1:A}"
  else
    out="$(dirname "$root")/${dir}_$(date +%Y%m%d-%H%M%S).zip"
  fi

  cd "$root" || exit 1

  local overwrite=0
  [ -f "$out" ] && overwrite=1
  rm -f "$out"

  local files
  files="$(git ls-files -c --exclude-standard)"
  if [ -z "$files" ]; then
    echo "Error: no tracked files to archive." >&2
    exit 1
  fi

  git ls-files -c --exclude-standard -z |
    xargs -0 zip -q "$out" -- || {
      echo "Error: Failed to create zip archive." >&2
      exit 1
    }

  if [ "$overwrite" -eq 1 ]; then
    echo "overwritten: $out"
  else
    echo "created: $out"
  fi
)

# Usage: dev_alias_as <target_command> <prefix> [run_prefix]
dev_alias_as() {
	local target_command="$1"
	local prefix="$2"
	local run_prefix="${3:-}" # Make run_prefix optional, default to empty

	# Basic command alias
	alias "${prefix}=${target_command}"

	# Construct command with optional run_prefix
	local cmd_prefix="${target_command}"
	if [ -n "$run_prefix" ]; then
		cmd_prefix="${target_command} ${run_prefix}"
	fi

	# Standard development commands
	alias "${prefix}-h=${cmd_prefix} help"
	alias "${prefix}-i=${cmd_prefix} install"
	alias "${prefix}-s=${cmd_prefix} setup"
	alias "${prefix}-op=${cmd_prefix} open"

	alias "${prefix}-g=${cmd_prefix} gen"
	alias "${prefix}-ga=${cmd_prefix} gen-as"
	alias "${prefix}-gp=${cmd_prefix} gen-pj"

	alias "${prefix}-fmt=${cmd_prefix} format"
	alias "${prefix}-f=${cmd_prefix} fix"
	alias "${prefix}-l=${cmd_prefix} lint"
	alias "${prefix}-c=${cmd_prefix} check"
	alias "${prefix}-cln=${cmd_prefix} clean"

	alias "${prefix}-b=${cmd_prefix} build"
	alias "${prefix}-b-d=${cmd_prefix} build-debug"
	alias "${prefix}-b-r=${cmd_prefix} build-release"
	alias "${prefix}-rb=${cmd_prefix} rebuild"
	alias "${prefix}-rb-p=${cmd_prefix} rebuild-prod"

	if [ -n "$run_prefix" ]; then
		alias "${prefix}-r=${cmd_prefix}"
	else
		alias "${prefix}-r=${cmd_prefix} run"
	fi
	alias "${prefix}-r-d=${cmd_prefix} run-debug"
	alias "${prefix}-r-r=${cmd_prefix} run-release"
	alias "${prefix}-r-p=${cmd_prefix} run-prod"
	alias "${prefix}-e=${cmd_prefix} exec"

	alias "${prefix}-rp=${cmd_prefix} resolve-packages"

	alias "${prefix}-u=${cmd_prefix} up"
	alias "${prefix}-u-p=${cmd_prefix} up-prod"
	alias "${prefix}-d=${cmd_prefix} down"
	alias "${prefix}-d-p=${cmd_prefix} down-prod"

	# Test variations
	alias "${prefix}-cov=${cmd_prefix} coverage"
	alias "${prefix}-t=${cmd_prefix} test"
	alias "${prefix}-ut=${cmd_prefix} unit-test"
	alias "${prefix}-uit=${cmd_prefix} ui-test"
	alias "${prefix}-et=${cmd_prefix} e2e-test"
	alias "${prefix}-lt=${cmd_prefix} local-test"
	alias "${prefix}-dt=${cmd_prefix} docker-test"
	alias "${prefix}-dmt=${cmd_prefix} demo-test"
	alias "${prefix}-at=${cmd_prefix} api-test"
	alias "${prefix}-sqt=${cmd_prefix} sqlt-test"
	alias "${prefix}-pst=${cmd_prefix} psql-test"
	alias "${prefix}-sdt=${cmd_prefix} sdk-test"
	alias "${prefix}-pet=${cmd_prefix} perf-test"
	alias "${prefix}-it=${cmd_prefix} intg-test"
	alias "${prefix}-bt=${cmd_prefix} build-test"
	alias "${prefix}-pt=${cmd_prefix} pkg-test"
}
