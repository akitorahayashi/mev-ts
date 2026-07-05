hd() {
  if command herdr status server >/dev/null 2>&1; then
    command herdr workspace create \
      --cwd "$PWD" \
      --focus >/dev/null || return
  fi

  command herdr
}

alias hd-a="herdr"
alias hd-u="herdr update"
alias hd-st="herdr status"
alias hd-rel="herdr server reload-config"
alias hd-s-s="herdr server stop"
