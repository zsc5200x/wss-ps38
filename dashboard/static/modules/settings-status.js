import { numberFormatter } from "./constants.js";
import { dom } from "./dom.js";
import { state } from "./state.js";
import { formatClock, formatShortDate, formatDuration } from "./shared/format.js";
import { formatSettingsBytes, settingsValue } from "./shared/settings-format.js";

export function renderSettingsStatusFromSnapshot(snapshot = state.snapshot) {
  const source = snapshot?.source || {};
  const stats = snapshot?.stats || {};
  const freshness = snapshot?.freshness || "no-data";
  const freshnessLabel = {
    live: "实时",
    delayed: "延迟",
    stale: "停止",
    "no-data": "无数据",
  }[freshness] || "未知";
  if (dom.settingsDashboardState) {
    dom.settingsDashboardState.textContent = "运行中";
    dom.settingsDashboardState.className = "settings-state-good";
    dom.settingsDashboardDetail.textContent = `接口正常 · ${formatClock(snapshot?.serverTime)}`;
  }
  if (dom.settingsDataState) {
    dom.settingsDataState.textContent = freshnessLabel;
    dom.settingsDataState.className = freshness === "live" ? "settings-state-good" : "settings-state-warn";
    dom.settingsDataDetail.textContent = source.lastCapturedAt
      ? `最近采集 ${formatShortDate(source.lastCapturedAt)} · 延迟 ${formatDuration(snapshot?.lagSeconds)}`
      : "尚未收到采集数据";
  }
  if (dom.settingsDatabaseState) {
    const errors = Number(source.databaseErrors || 0);
    dom.settingsDatabaseState.textContent = errors ? `异常 ${errors} 次` : "正常";
    dom.settingsDatabaseState.className = errors ? "settings-state-warn" : "settings-state-good";
    dom.settingsDatabaseDetail.textContent = `${formatSettingsBytes(source.databaseBytes)} · 历史 ${numberFormatter.format(source.persistedPoints || 0)} 点`;
  }
  if (dom.settingsMetadataState) {
    const missing = Number(stats.missing || 0);
    const partial = Number(stats.partial || 0);
    dom.settingsMetadataState.textContent = missing ? `缺失 ${numberFormatter.format(missing)}` : "完整";
    dom.settingsMetadataState.className = missing ? "settings-state-warn" : "settings-state-good";
    dom.settingsMetadataDetail.textContent = `完整 ${numberFormatter.format(stats.complete || 0)} · 部分 ${numberFormatter.format(partial)}`;
  }
  if (dom.settingsStatusUpdated) {
    dom.settingsStatusUpdated.textContent = snapshot?.serverTime
      ? `更新于 ${formatClock(snapshot.serverTime)}`
      : "等待状态";
  }
  if (dom.settingsCapturePath) dom.settingsCapturePath.textContent = settingsValue(source.capturePath, "--");
  if (dom.settingsDatabasePath) dom.settingsDatabasePath.textContent = settingsValue(source.databasePath, "--");
}

