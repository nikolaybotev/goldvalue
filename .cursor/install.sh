#!/usr/bin/env bash
set -euo pipefail

if [ ! -x "${HOME}/.local/bin/mise" ]; then
  curl -fsSL https://mise.run/bash | sh
fi

export PATH="${HOME}/.local/bin:${PATH}"
eval "$(mise activate bash)"

# .nvmrc and engines.node pin Node 26. packageManager is pnpm@12.6.0.
# Deploy and the current CI interpreter are Python 3.12 (the CLI still runs on 3.9+).
# No mise.toml in the repo; pin the tools here so install does not write one.
mise install node@26 python@3.12
mise use -g node@26 python@3.12
mise reshim

corepack enable
corepack prepare pnpm@12.6.0 --activate
mise reshim

# Cloud Agent Skills menu and runtime read ~/.cursor/skills-cursor. Existing skill folders are left in place.
curl -fsSL https://raw.githubusercontent.com/nikolaybotev/local-skills/main/install.sh | sh -s -- ~/.cursor/skills-cursor
