alias ml-ls="hf cache ls --filter type=model --sort name"

ml-z() {
  local model="${1:-mlx-community/Qwen3.5-4B-4bit}"

  mlx_lm.server \
    --model "$model" \
    --host 127.0.0.1 \
    --port 8080 \
    --max-tokens 512 \
    --prefill-step-size 512 \
    --chat-template-args '{"enable_thinking":false}' \
    --temp 0
}
