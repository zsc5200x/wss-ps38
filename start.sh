#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PYTHON_BIN="${PYTHON_BIN:-$PROJECT_DIR/.venv/bin/python}"
CROWN_PYTHON_BIN="${CROWN_PYTHON_BIN:-$PROJECT_DIR/crown/.venv/bin/python}"
RUN_DIR="$PROJECT_DIR/.run"
LOG_DIR="$PROJECT_DIR/logs"
CHROME_PID_FILE="$RUN_DIR/chrome.pid"

mkdir -p "$RUN_DIR" "$LOG_DIR"

if [[ ! -x "$CROWN_PYTHON_BIN" ]]; then
  echo "找不到皇冠 Python 虚拟环境：$CROWN_PYTHON_BIN" >&2
  echo "请先在 crown 目录准备虚拟环境并安装依赖。" >&2
  exit 1
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "找不到 Python 虚拟环境：$PYTHON_BIN" >&2
  echo "请先创建环境并安装依赖：$ python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

if ! "$PYTHON_BIN" -c 'import playwright' >/dev/null 2>&1; then
  echo "当前 Python 环境缺少 playwright。请执行：$PYTHON_BIN -m pip install -r requirements.txt" >&2
  exit 1
fi

CONFIG_FILE="${PS3838_CONFIG:-$PROJECT_DIR/config.json}"
CDP_URL="${CDP_URL:-http://127.0.0.1:9222}"
CAPTURE_PATH="$PROJECT_DIR/capture.jsonl"
EVENTS_FILE="$PROJECT_DIR/events_list.csv"
CHROME_BINARY="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_PROFILE_DIR="$HOME/.ps3838-wss-chrome-profile"
START_URL="https://www.ps3838.com/zh-cn/sports/soccer"
CHROME_STARTED=0

if [[ -f "$CONFIG_FILE" ]]; then
  CONFIG_VALUES=()
  while IFS= read -r CONFIG_VALUE; do
    CONFIG_VALUES+=("$CONFIG_VALUE")
  done < <(
    "$PYTHON_BIN" - "$CONFIG_FILE" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except (OSError, ValueError) as exc:
    raise SystemExit(f"配置文件读取失败: {exc}")

print(data.get("cdp_url", ""))
print(data.get("capture_path", ""))
print(data.get("events_file", ""))
print(data.get("chrome_binary", ""))
print(data.get("chrome_profile_dir", ""))
print(data.get("start_url") or data.get("target_url") or "")
PY
  )
  [[ -n "${CONFIG_VALUES[0]:-}" ]] && CDP_URL="${CONFIG_VALUES[0]}"
  [[ -n "${CONFIG_VALUES[1]:-}" ]] && CAPTURE_PATH="${CONFIG_VALUES[1]}"
  [[ -n "${CONFIG_VALUES[2]:-}" ]] && EVENTS_FILE="${CONFIG_VALUES[2]}"
  [[ -n "${CONFIG_VALUES[3]:-}" ]] && CHROME_BINARY="${CONFIG_VALUES[3]}"
  [[ -n "${CONFIG_VALUES[4]:-}" ]] && CHROME_PROFILE_DIR="${CONFIG_VALUES[4]}"
  [[ -n "${CONFIG_VALUES[5]:-}" ]] && START_URL="${CONFIG_VALUES[5]}"
fi

if [[ "$CAPTURE_PATH" == "~"/* ]]; then
  CAPTURE_PATH="$HOME/${CAPTURE_PATH:2}"
elif [[ "$CAPTURE_PATH" != /* ]]; then
  CAPTURE_PATH="$PROJECT_DIR/$CAPTURE_PATH"
fi
if [[ "$EVENTS_FILE" == "~"/* ]]; then
  EVENTS_FILE="$HOME/${EVENTS_FILE:2}"
elif [[ "$EVENTS_FILE" != /* ]]; then
  EVENTS_FILE="$PROJECT_DIR/$EVENTS_FILE"
fi
if [[ "$CHROME_BINARY" == "~"/* ]]; then
  CHROME_BINARY="$HOME/${CHROME_BINARY:2}"
fi
if [[ "$CHROME_PROFILE_DIR" == "~"/* ]]; then
  CHROME_PROFILE_DIR="$HOME/${CHROME_PROFILE_DIR:2}"
elif [[ "$CHROME_PROFILE_DIR" != /* ]]; then
  CHROME_PROFILE_DIR="$PROJECT_DIR/$CHROME_PROFILE_DIR"
fi

export CAPTURE_CDP_URL="$CDP_URL"
export CAPTURE_OUTPUT="$CAPTURE_PATH"
export PS3838_CONFIG="$CONFIG_FILE"
export CROWN_CDP_URL="$CDP_URL"

cdp_is_ready() {
  curl -fsS --max-time 3 "$CDP_URL/json/version" >/dev/null 2>&1
}

if ! cdp_is_ready; then
  if [[ ! -x "$CHROME_BINARY" ]]; then
    echo "无法启动 Chrome：找不到可执行文件 $CHROME_BINARY" >&2
    echo "请修改 config.json 中的 chrome_binary。" >&2
    exit 1
  fi

  CDP_PORT="$($PYTHON_BIN - "$CDP_URL" <<'PY'
from urllib.parse import urlsplit
import sys

parsed = urlsplit(sys.argv[1])
print(parsed.port or 9222)
PY
  )"

  mkdir -p "$CHROME_PROFILE_DIR"
  echo "Chrome CDP 未启动，正在启动项目专用 Chrome。"
  echo "Chrome 配置目录：$CHROME_PROFILE_DIR"
  echo "自动打开：$START_URL"
  nohup "$CHROME_BINARY" \
    --remote-debugging-port="$CDP_PORT" \
    --user-data-dir="$CHROME_PROFILE_DIR" \
    --no-first-run \
    "$START_URL" >>"$LOG_DIR/chrome.log" 2>&1 &
  chrome_pid=$!
  CHROME_STARTED=1
  echo "$chrome_pid" >"$CHROME_PID_FILE"

  ready=0
  for _ in {1..20}; do
    if cdp_is_ready; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [[ "$ready" != 1 ]]; then
    echo "Chrome 已启动但 CDP 仍不可用：$CDP_URL" >&2
    echo "请查看日志：$LOG_DIR/chrome.log" >&2
    exit 1
  fi
else
  echo "Chrome CDP 已可用：$CDP_URL"
fi

# CDP 已存在时，优先通过 DevTools 的 /json/new 打开目标赛事页面，
# 这样不会因为重复执行 start.sh 而创建多个相同标签页。
if [[ "$CHROME_STARTED" != 1 && -n "$START_URL" && -x "$CHROME_BINARY" ]]; then
  START_HOST="$($PYTHON_BIN - "$START_URL" <<'PY'
from urllib.parse import urlsplit
import sys

print(urlsplit(sys.argv[1]).hostname or "")
PY
  )"
  if ! curl -fsS --max-time 3 "$CDP_URL/json/list" \
    | grep -F '"url"' \
    | grep -F -- "$START_HOST" >/dev/null 2>&1; then
    ENCODED_START_URL="$($PYTHON_BIN - "$START_URL" <<'PY'
from urllib.parse import quote
import sys

print(quote(sys.argv[1], safe=""))
PY
    )"
    if ! curl -fsS --max-time 3 -X PUT \
      "$CDP_URL/json/new?$ENCODED_START_URL" >/dev/null 2>&1; then
      # 旧版 Chrome 可能不支持 /json/new 的 PUT 方式，使用 Chrome
      # 命令行作为兼容回退；Chrome 会把 URL 转交给已有实例。
      nohup "$CHROME_BINARY" \
        --user-data-dir="$CHROME_PROFILE_DIR" \
        "$START_URL" >>"$LOG_DIR/chrome.log" 2>&1 &
    fi
  fi
fi

if [[ ! -f "$EVENTS_FILE" ]]; then
  echo "缺少赛事映射文件：$EVENTS_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$CAPTURE_PATH")"
touch "$CAPTURE_PATH"

is_running() {
  local pid_file="$1"
  local expected="$2"
  [[ -s "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file")"
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -F -- "$expected" >/dev/null
}

start_one() {
  local name="$1"
  local script="$2"
  local pid_file="$RUN_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  # A stale PID file can leave a healthy dashboard running without a valid
  # process record. Reconcile the fixed dashboard port before starting a
  # second instance, otherwise the new process exits with EADDRINUSE.
  if [[ "$name" == "dashboard" ]]; then
    local port_pid=""
    port_pid="$(lsof -nP -tiTCP:8787 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
    if [[ -n "$port_pid" ]]; then
      local port_command=""
      port_command="$(ps -p "$port_pid" -o command= 2>/dev/null || true)"
      if [[ "$port_command" == *"$script"* ]]; then
        echo "$port_pid" >"$pid_file"
        echo "$name 已在运行，PID=$port_pid"
        return 0
      fi
      echo "端口 8787 已被其他进程占用（PID=$port_pid），无法启动 $name。" >&2
      return 1
    fi
  fi

  if is_running "$pid_file" "$script"; then
    echo "$name 已在运行，PID=$(cat "$pid_file")"
    return 0
  fi

  rm -f "$pid_file"
  nohup "$PYTHON_BIN" -u "$script" >>"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"
  sleep 1

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$name 启动失败，请查看 $log_file" >&2
    rm -f "$pid_file"
    return 1
  fi

  echo "$name 已启动，PID=${pid}，日志=${log_file}"
}

start_one capture capture.py
sleep 1
CROWN_PYTHON_BIN="$CROWN_PYTHON_BIN" "$PROJECT_DIR/crown.sh"
sleep 1
if ! "$CROWN_PYTHON_BIN" "$PROJECT_DIR/crown/ensure_login_tab.py" \
  --cdp-url "$CDP_URL" \
  --service-url "http://127.0.0.1:8887"; then
  echo "皇冠页面标签页未能打开；请查看皇冠服务状态后重试。" >&2
fi
start_one dashboard dashboard_server.py
sleep 1
start_one live_snapshot live_snapshot.py

echo
echo "项目已启动。"
echo "统一看板：http://127.0.0.1:8787"
echo "皇冠入口：http://127.0.0.1:8787/#crown"
echo "实时输出：请查看 latest_odds_live.csv 或 config.json 中的 live_snapshot_file"
echo "停止命令：$PROJECT_DIR/stop.sh"
