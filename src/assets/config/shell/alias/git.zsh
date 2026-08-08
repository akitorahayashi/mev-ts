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

# Auto-generated git aliases from git config
generate_git_aliases() {
	# Get aliases from every global config source and add a 'g' prefix.
	git config --show-scope --name-only --get-regexp '^alias\.' 2>/dev/null |
		sed -nE 's/^global[[:space:]]+alias\.([^ ]+)$/alias g\1="git \1"/p'
}

# Generate and source git aliases
eval "$(generate_git_aliases)"
