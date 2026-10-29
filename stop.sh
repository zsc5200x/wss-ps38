#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$PROJECT_DIR/.run"

stop_one() {
  local name="$1"
  local script="$2"
  local pid_file="$RUN_DIR/$name.pid"

  [[ -f "$pid_file" ]] || return 0

  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null; then
    local command
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"$script"* ]]; then
      echo "正在停止 ${name}（PID=${pid}）..."
      kill "$pid" 2>/dev/null || true
      for _ in {1..20}; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      if kill -0 "$pid" 2>/dev/null; then
        echo "$name 未在规定时间内退出，发送强制停止信号。" >&2
        kill -KILL "$pid" 2>/dev/null || true
      fi
    else
      echo "PID 文件 ${pid_file} 指向的进程不是 ${script}，已跳过。" >&2
    fi
  fi

  rm -f "$pid_file"
}

stop_one dashboard dashboard_server.py
stop_one crown crown/app.py

# Also handle Crown processes that were started manually before .run/crown.pid
# existed. A process must either use the full project path or run app.py from
# crown/, so unrelated Python servers are never matched by name alone.
crown_pid="$(lsof -nP -tiTCP:8887 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [[ -n "$crown_pid" ]] && kill -0 "$crown_pid" 2>/dev/null; then
  crown_command="$(ps -p "$crown_pid" -o command= 2>/dev/null || true)"
  crown_cwd="$(lsof -a -p "$crown_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
  if [[ "$crown_command" == *"crown/app.py"* ]] ||      [[ "$crown_command" == *"app.py"* && "$crown_cwd" == "$PROJECT_DIR/crown" ]]; then
    echo "正在停止未纳管的皇冠服务（PID=${crown_pid}）..."
    kill "$crown_pid" 2>/dev/null || true
    for _ in {1..20}; do
      kill -0 "$crown_pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$crown_pid" 2>/dev/null; then
      kill -KILL "$crown_pid" 2>/dev/null || true
    fi
  else
    echo "端口 8887 上的进程无法确认为皇冠服务，已跳过。" >&2
  fi
fi
rm -f "$RUN_DIR/crown.pid"

stop_one live_snapshot live_snapshot.py
stop_one capture capture.py
rm -f "$RUN_DIR/chrome.pid"
echo "统一看板及数据进程已停止。Chrome 不会被关闭。"
