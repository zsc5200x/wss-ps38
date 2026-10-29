#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${PYTHON_BIN:-$PROJECT_DIR/.venv/bin/python}" "$PROJECT_DIR/scripts/check.py" "$@"
