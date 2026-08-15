alias cpt="copilot"
alias cpt-ln=cpt_ln
cpt_ln() {
  local source_path="${MEV_CODER_AGENTS_PATH:-$HOME/.mev/coder/AGENTS.md}"
  source_path="${source_path:A}"

  if [ ! -e "$source_path" ]; then
    echo "Missing Copilot instructions source: $source_path" >&2
    return 1
  fi

  mkdir -p .github
  ln -sf "$source_path" .github/copilot-instructions.md
}
