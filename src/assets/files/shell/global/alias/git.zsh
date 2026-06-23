alias g="git"
alias gi="git"

# Auto-generated git aliases from git config
generate_git_aliases() {
	# Get global git aliases and convert them to zsh aliases with 'g' prefix
	git config --global --get-regexp '^alias\.' 2>/dev/null |
		sed -E 's/^alias\.([^ ]*).*/alias g\1="git \1"/'
}

# Generate and source git aliases
eval "$(generate_git_aliases)"
