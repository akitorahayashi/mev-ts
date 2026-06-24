# =============================================================================
# Zsh Prompt Configuration File Rules
# =============================================================================
#
# This file defines aliases for quickly copying lightweight prompts to interact with AI assistants.
#
# Rules:
# - Alias names: Short, descriptive (e.g., sum-f, tr-e)
# - Prompt format: Action-oriented, concise (e.g., "Translate to English:")
# - Prompts must be in English
# - Implementation: Use copy_prompt function with prompt as argument
# - Do not delete or modify these rules
#
# =============================================================================

# Function to copy prompt to clipboard and show success message
_copy_prompt() {
	local prompt="$1"
	echo "$prompt" | pbcopy
	echo "✅ Copied \"$prompt\" to clipboard"
}

alias sm-f="_copy_prompt 'Summarize this file'"
alias sm-p="_copy_prompt 'Summarize this project'"

alias tr-e="_copy_prompt 'Translate to English in up to 3 patterns'"
alias tr-j="_copy_prompt 'Translate to Japanese in up to 3 patterns'"
