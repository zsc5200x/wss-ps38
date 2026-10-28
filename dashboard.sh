#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PYTHON_BIN="${PYTHON_BIN:-$PROJECT_DIR/.venv/bin/python}"
RUN_DIR="$PROJECT_DIR/.run"
LOG_DIR="$PROJECT_DIR/logs"
PID_FILE="$RUN_DIR/dashboard.pid"
LOG_FILE="$LOG_DIR/dashboard.log"
HOST="${DASHBOARD_HOST:-127.0.0.1}"
PORT="${DASHBOARD_PORT:-8787}"
URL="http://$HOST:$PORT"

mkdir -p "$RUN_DIR" "$LOG_DIR"

if [[ ! -x "$PROJECT_DIR/crown.sh" ]]; then
  echo "找不到皇冠启动脚本：$PROJECT_DIR/crown.sh" >&2
  exit 1
fi

# The Crown panel is part of the same UI, so starting the dashboard also
# ensures that its local backend is available for the /crown proxy.
"$PROJECT_DIR/crown.sh"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "找不到 Python 虚拟环境：$PYTHON_BIN" >&2
  exit 1
fi

if [[ -s "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null && \
     ps -p "$PID" -o command= 2>/dev/null | grep -F -- "dashboard_server.py" >/dev/null; then
    echo "看板已在运行：${URL}（PID=${PID}）"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup "$PYTHON_BIN" -u dashboard_server.py \
  --host "$HOST" --port "$PORT" >>"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"
sleep 1

if ! kill -0 "$PID" 2>/dev/null; then
  echo "看板启动失败，请查看：$LOG_FILE" >&2
  rm -f "$PID_FILE"
  exit 1
fi

READY=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "$URL/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ "$READY" -ne 1 ]]; then
  echo "看板进程已启动，但健康检查失败，请查看：$LOG_FILE" >&2
  exit 1
fi

echo "统一看板已启动：${URL}（PID=${PID}）"
echo "皇冠入口：${URL}/#crown"
echo "日志：$LOG_FILE"
