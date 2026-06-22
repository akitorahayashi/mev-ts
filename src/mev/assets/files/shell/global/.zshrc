# shellcheck disable=SC2148,SC1090,SC1091
alias me="mev"
export SHELL_START_DIR="${SHELL_START_DIR:-$PWD}"

autoload -Uz compinit
compinit

zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'

# dev_alias_as must be loaded before files that call it.
for config_file in "$HOME/.mev/alias/dev/dev.zsh" "$HOME/.mev/alias/dev/dev.sh"; do
  [[ -r "$config_file" ]] || continue
  source "$config_file"
  break
done

_load_alias_configs() {
  setopt local_options null_glob

  for config_file in "$HOME"/.mev/alias/**/*.zsh "$HOME"/.mev/alias/**/*.sh; do
    [[ "$config_file" == "$HOME/.mev/alias/dev/dev.zsh" ]] && continue
    [[ "$config_file" == "$HOME/.mev/alias/dev/dev.sh" ]] && continue
    [[ -r "$config_file" ]] && source "$config_file"
  done
}
_load_alias_configs
unfunction _load_alias_configs

if command -v rbenv >/dev/null 2>&1; then
  eval "$(rbenv init - zsh)"
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --use-on-cd --version-file-strategy=recursive --shell zsh)"
fi

if [[ -n "${HOMEBREW_PREFIX:-}" ]] || command -v brew >/dev/null 2>&1; then
  BREW_PREFIX="${HOMEBREW_PREFIX:-$(brew --prefix)}"
  [[ -r "$BREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh" ]] &&
    source "$BREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
  [[ -r "$BREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]] &&
    source "$BREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
fi
unset BREW_PREFIX

if command -v fzf >/dev/null 2>&1; then
  source <(fzf --zsh)
fi

if command -v zoxide >/dev/null 2>&1; then
  eval "$(zoxide init zsh)"
fi
