alias py="python"

# pytest
alias pts="pytest"

ws() {
  if [[ $# -eq 0 ]]; then
    echo "Error: No input file provided." >&2
    return 1
  fi
  local input_dir
  local filename
  input_dir=$(dirname "$1")
  filename=$(basename "$1" .mp4)
  local output_dir="${input_dir}/.whisper/${filename}"
  mkdir -p "$output_dir"

  whisper "$@" \
    --language Japanese \
    --model medium \
    --output_dir "$output_dir" \
    --output_format all \
    --word_timestamps True \
    --temperature 0
}

gmp4() {
  if [[ $# -eq 0 ]]; then
    echo "Error: No URL provided." >&2
    return 1
  fi
  yt-dlp \
    --no-playlist \
    -P "$PWD" \
    -o "%(title).200B [%(id)s].%(ext)s" \
    -f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b" \
    --merge-output-format mp4 \
    --remux-video mp4 \
    "$@"
}

# python project cleanup
py-cln() {
  echo "🧹 Cleaning up project..."
  find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
  rm -rf .venv
  rm -rf .pytest_cache
  rm -rf .ruff_cache
  echo "✅ Cleanup completed"
}

# venv
act() {
  if [[ $# -eq 1 ]]; then
    # shellcheck disable=SC1090,SC1091
    source "./$1/bin/activate"
  else
    # shellcheck disable=SC1091
    source "./.venv/bin/activate"
  fi
}
alias dct='deactivate'
