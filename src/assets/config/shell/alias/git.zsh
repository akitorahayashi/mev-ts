git() {
	if [[ "${1-}" == "clone" ]]; then
		shift
		if (( ! $+commands[gv] )); then
			print -u2 -- "git clone requires gv; run 'mev make grove --upgrade'."
			return 127
		fi
		command gv clone "$@"
	else
		command git "$@"
	fi
}

alias g="git"
alias gi="git"

# A git alias runs in a subprocess and so cannot move the caller; only a shell
# function can. `w-p` writes one worktree path and nothing else, which is what
# makes the substitution safe. Clipanion prints a usage error on stdout, where
# the substitution swallows it, so a non-zero status re-emits it on stderr.
# Not named with a `g` prefix: generate_git_aliases evals an `alias g<name>` for
# every git alias, and zsh resolves aliases before functions.
wcd() {
	local target
	if ! target="$(command git w-p "$@")"; then
		[[ -n "$target" ]] && print -ru2 -- "$target"
		return 1
	fi
	cd "$target" || return
}

# Auto-generated git aliases from git config
generate_git_aliases() {
	# Get aliases from every global config source and add a 'g' prefix.
	git config --show-scope --name-only --get-regexp '^alias\.' 2>/dev/null |
		sed -nE 's/^global[[:space:]]+alias\.([^ ]+)$/alias g\1="git \1"/p'
}

# Generate and source git aliases
eval "$(generate_git_aliases)"
