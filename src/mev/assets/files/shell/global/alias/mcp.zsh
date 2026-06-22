# VOICEVOX Engine aliases
alias vce-st='docker run -d -p 50021:50021 --name voicevox-engine voicevox/voicevox_engine:cpu-ubuntu22.04-latest'
alias vce-sp='docker stop voicevox-engine && docker rm voicevox-engine'
alias vce-ls='curl http://localhost:50021/speakers | jq .'
# VOICEVOX MCP Server alias
alias vce-mcp='npx @t09tanaka/mcp-simple-voicevox'

# serena aliases
alias ux-sn-idx='uvx --from git+https://github.com/oraios/serena serena project index "$(pwd)"'
