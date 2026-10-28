#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CROWN_DIR="$PROJECT_DIR/crown"
PYTHON_BIN="${CROWN_PYTHON_BIN:-$CROWN_DIR/.venv/bin/python}"
RUN_DIR="$PROJECT_DIR/.run"
LOG_DIR="$PROJECT_DIR/logs"
PID_FILE="$RUN_DIR/crown.pid"
LOG_FILE="$LOG_DIR/crown.log"
HOST="127.0.0.1"
PORT="8887"
URL="http://$HOST:$PORT"

mkdir -p "$RUN_DIR" "$LOG_DIR"

is_managed_pid() {
  local pid="$1"
  local command process_cwd
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ "$command" == *"crown/app.py"* ]]; then
    return 0
  fi
  # A manually started process may show only as "python app.py"; its working
  # directory still identifies it as this project's Crown runtime.
  process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
  [[ "$command" == *"app.py"* && "$process_cwd" == "$CROWN_DIR" ]]
}

is_ready() {
  curl -fsS --max-time 2 "$URL/api/crown/session" >/dev/null 2>&1
}

if [[ -s "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if is_managed_pid "$PID"; then
    echo "皇冠服务已在运行：${URL}/crown（PID=${PID}）"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Adopt an already-healthy process (for example one started manually before the
# unified launcher was introduced) instead of starting a duplicate listener.
if is_ready; then
  EXISTING_PID="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if is_managed_pid "$EXISTING_PID"; then
    echo "$EXISTING_PID" >"$PID_FILE"
    echo "皇冠服务已在运行：${URL}/crown（PID=${EXISTING_PID}）"
    exit 0
  fi
  echo "端口 ${PORT} 上已有皇冠接口响应，但无法确认进程归属；将继续使用现有服务。" >&2
  exit 0
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "找不到皇冠 Python 虚拟环境：$PYTHON_BIN" >&2
  echo "请先在 crown 目录创建环境并安装依赖。" >&2
  exit 1
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 ${PORT} 已被其他进程占用，无法启动皇冠服务：" >&2
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  exit 1
fi

nohup "$PYTHON_BIN" -u "$CROWN_DIR/app.py" >>"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"

READY=0
for _ in $(seq 1 30); do
  if is_ready; then
    READY=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ "$READY" -ne 1 ]]; then
  echo "皇冠服务启动失败，请查看：$LOG_FILE" >&2
  kill "$PID" 2>/dev/null || true
  rm -f "$PID_FILE"
  exit 1
fi

echo "皇冠服务已启动：${URL}/crown（PID=${PID}）"
echo "日志：$LOG_FILE"
