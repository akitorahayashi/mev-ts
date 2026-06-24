# shellcheck disable=SC2148
typeset -U path

_path_prepend() {
  [[ -d "$1" ]] && path=("$1" "${path[@]}")
}

_path_append() {
  [[ -d "$1" ]] && path+=("$1")
}

# Homebrew initialization
_brew_bin="$(command -v brew 2>/dev/null)"
if [[ -z "$_brew_bin" ]]; then
  for _brew_candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$_brew_candidate" ]]; then
      _brew_bin="$_brew_candidate"
      break
    fi
  done
fi

if [[ -x "$_brew_bin" ]]; then
  eval "$("$_brew_bin" shellenv)"
fi
unset _brew_bin _brew_candidate

_path_prepend "$HOME/.local/bin"
_path_prepend "$HOME/.cargo/bin"
_path_prepend "$HOME/.local/pipx/venvs/mlx-hub/bin"
_path_prepend "$HOME/.menv/venvs/mlx-lm/bin"
_path_prepend "/opt/homebrew/opt/poppler/bin"
_path_prepend "$PNPM_HOME/bin"
_path_prepend "$BUN_INSTALL/bin"

_path_prepend "$ANDROID_HOME/cmdline-tools/latest/bin"
_path_prepend "$ANDROID_HOME/tools/bin"
_path_prepend "$ANDROID_HOME/platform-tools"
_path_append "$ANDROID_HOME/emulator"
