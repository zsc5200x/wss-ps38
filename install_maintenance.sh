#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.ps3838-wss.maintenance"
SOURCE="$PROJECT_DIR/$LABEL.plist"
DESTINATION="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT_DIR/logs"
cp "$SOURCE" "$DESTINATION"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$DESTINATION"
launchctl enable "gui/$(id -u)/$LABEL"

echo "已安装每日维护任务：$LABEL"
echo "执行时间：每天 04:15"
echo "任务文件：$DESTINATION"
echo "日志：$PROJECT_DIR/logs/maintenance.log"
