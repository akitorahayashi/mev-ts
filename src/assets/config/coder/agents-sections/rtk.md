## RTK

- RTK is available as the `rtk` shell command in mev-provisioned coder environments.
- Claude Code and Codex shell hooks may rewrite supported Bash commands through `rtk rewrite` before execution.
- Commands that already start with `rtk` remain unchanged and are not prefixed again.
- Installation verification uses `rtk --version`; analytics and history commands are optional and are not part of provisioning checks.
