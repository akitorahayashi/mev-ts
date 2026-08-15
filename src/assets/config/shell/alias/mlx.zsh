# Usage: ml-z <model>
ml-z() {
  local model="$1"
  if [[ -z "$model" ]]; then
    print -u2 -- "ml-z requires a model, e.g. ml-z mlx-community/Qwen2.5-Coder-3B-Instruct-4bit"
    return 1
  fi

  mlx_lm.server \
    --model "$model" \
    --host 127.0.0.1 \
    --port 8080 \
    --max-tokens 128 \
    --temp 0
}
