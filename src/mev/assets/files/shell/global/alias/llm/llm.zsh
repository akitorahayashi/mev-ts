alias cld="claude"

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

alias cdx="codex"
alias cdx-e="codex exec"
alias cdx-r="codex resume"

alias cpt="copilot"
alias cpt-ln=cpt_ln
cpt_ln() {
	local source_path="${MEV_CODER_AGENTS_PATH:-$HOME/.config/mev/coder/AGENTS.md}"
	source_path="${source_path:A}"

	if [ ! -e "$source_path" ]; then
		echo "Missing Copilot instructions source: $source_path" >&2
		return 1
	fi

	mkdir -p .github
	ln -sf "$source_path" .github/copilot-instructions.md
}

ml-z() {
	mlx_lm.server \
		--model "${MLX_ZED_COMMIT_MODEL:-mlx-community/Qwen2.5-Coder-3B-Instruct-4bit}" \
		--host 127.0.0.1 \
		--port 8080 \
		--max-tokens 128 \
		--temp 0
}
