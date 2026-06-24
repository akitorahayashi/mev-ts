alias al="alias"
al-c() {
	if [[ $# -eq 0 ]]; then
		echo "Usage: al-c <alias_name>"
		return 1
	fi
	local alias_value="${aliases[$1]}"
	if [[ -z "$alias_value" ]]; then
		echo "Alias '$1' not found."
		return 1
	fi
	printf %s "$alias_value" | pbcopy
	echo "✅ Copied '$alias_value' to clipboard"
}
alias sc="source"
alias ec="echo"
alias ct="cat"
alias ex="exit"
alias wch="which"
alias tc="touch"
alias mkd="mkdir -p"
alias rel="source ~/.zshrc"
alias cl="clear"
alias tmp="echo 'template' | pbcopy && echo '✅ Copied \"template\" to clipboard'"
alias pcp="echo 'pbcopy' | pbcopy && echo '✅ Copied \"pbcopy\" to clipboard'"
alias gip="ipconfig getifaddr"
alias ud="cd .."
alias uu="cd ../.."
alias uuu="cd ../../.."
alias rt='cd "${SHELL_START_DIR}"'

alias bt="bat"
alias e="eza --group-directories-first"
eza-tree() {
	if [[ $# -ne 1 ]]; then
		echo "Usage: e-t <level>"
		return 1
	fi

	if [[ ! "$1" =~ ^[1-9][0-9]*$ ]]; then
		echo "Tree level must be a positive integer."
		return 1
	fi

	eza --tree --level="$1" --group-directories-first
}

e-t() {
	eza-tree "$@"
}

ez-t() {
	eza-tree "$@"
}

alias ls="eza"
