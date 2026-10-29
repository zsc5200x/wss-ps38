import { renderSettingsStatusFromSnapshot } from "./settings-status.js";
import { settingsValue } from "./shared/settings-format.js";
import { fetchJson } from "./shared/http.js";
import { dom } from "./dom.js";
import { startMetadataSync } from "./metadata.js";
import { showToast } from "./shared/dom.js";
import { state } from "./state.js";

export function settingsConfigFromPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.config && typeof payload.config === "object") return payload.config;
  if (payload.effective && typeof payload.effective === "object") return payload.effective;
  if (payload.settings && typeof payload.settings === "object") return payload.settings;
  return payload;
}

export function renderSettingsPayload(payload) {
  const config = settingsConfigFromPayload(payload);
  const defaults = payload?.defaults && typeof payload.defaults === "object" ? payload.defaults : {};
  state.settings.config = { ...config };
  state.settings.defaults = { ...defaults };
  state.settings.restartRequired = Array.isArray(payload?.pendingRestart)
    ? payload.pendingRestart
    : payload?.changed && Array.isArray(payload?.restartRequired)
      ? payload.restartRequired
      : [];

  const value = (key, fallback) => settingsValue(config[key], settingsValue(defaults[key], fallback));
  if (dom.settingsPresenceInterval) dom.settingsPresenceInterval.value = value("presence_interval_seconds", 5);
  if (dom.settingsSnapshotInterval) dom.settingsSnapshotInterval.value = value("snapshot_interval_seconds", 2);
  if (dom.settingsRotationMb) dom.settingsRotationMb.value = String(value("capture_rotation_mb", 0));
  if (dom.settingsCompressAfter) dom.settingsCompressAfter.value = value("capture_compress_after_hours", 24);
  if (dom.settingsCompressMin) dom.settingsCompressMin.value = value("capture_compress_min_mb", 16);
  if (dom.settingsBackupKeep) dom.settingsBackupKeep.value = value("backup_keep", 7);

  const readonly = payload?.readonly && typeof payload.readonly === "object" ? payload.readonly : {};
  const readonlyValue = (key, fallback = "--") => settingsValue(readonly[key], value(key, fallback));
  if (dom.settingsCapturePath) dom.settingsCapturePath.textContent = readonlyValue("capture_path", dom.settingsCapturePath.textContent || "--");
  if (dom.settingsDatabasePath) dom.settingsDatabasePath.textContent = readonlyValue("dashboard_db_path", dom.settingsDatabasePath.textContent || "--");
  if (dom.settingsBackupPath) dom.settingsBackupPath.textContent = readonlyValue("backup_dir", "--");
  if (dom.settingsCdpUrl) dom.settingsCdpUrl.textContent = readonlyValue("cdp_url", "--");
  if (dom.settingsTargetHosts) {
    const hosts = readonlyValue("target_hosts", []);
    dom.settingsTargetHosts.textContent = Array.isArray(hosts) ? hosts.join("、") : String(hosts || "--");
  }
  if (dom.settingsChromeProfile) dom.settingsChromeProfile.textContent = readonlyValue("chrome_profile_dir", "--");
  if (dom.settingsStartUrl) dom.settingsStartUrl.textContent = readonlyValue("start_url", "--");
  if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = payload?.message || "配置已读取";
  if (dom.settingsRestartNotice) {
    const pending = state.settings.restartRequired;
    dom.settingsRestartNotice.classList.toggle("hidden", pending.length === 0);
    dom.settingsRestartNotice.textContent = pending.length
      ? `有 ${pending.length} 项配置需要重启后生效：${pending.join("、")}`
      : "";
  }
  renderSettingsStatusFromSnapshot(state.snapshot);
}

export async function fetchSettings(showError = false) {
  if (state.settings.loading) return;
  state.settings.loading = true;
  if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = "读取配置中…";
  try {
    const { response, payload } = await fetchJson("/api/settings", { cache: "no-store" }, { timeoutMs: 15000, allowInvalidJson: true });

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderSettingsPayload(payload);
    state.settings.initialized = true;
  } catch (error) {
    if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = "配置读取失败";
    if (showError) showToast(`系统设置读取失败：${error.message || "请求失败"}`);
  } finally {
    state.settings.loading = false;
  }
}

export function collectSettingsForm() {
  return {
    presence_interval_seconds: Number(dom.settingsPresenceInterval?.value || 5),
    snapshot_interval_seconds: Number(dom.settingsSnapshotInterval?.value || 2),
    capture_rotation_mb: Number(dom.settingsRotationMb?.value || 0),
    capture_compress_after_hours: Number(dom.settingsCompressAfter?.value || 24),
    capture_compress_min_mb: Number(dom.settingsCompressMin?.value || 16),
    backup_keep: Number(dom.settingsBackupKeep?.value || 7),
  };
}

export async function saveSettings() {
  if (state.settings.saving) return;
  const values = collectSettingsForm();
  if (!Number.isFinite(values.presence_interval_seconds) || values.presence_interval_seconds < 5 || values.presence_interval_seconds > 60
    || !Number.isFinite(values.snapshot_interval_seconds) || values.snapshot_interval_seconds < 0.1 || values.snapshot_interval_seconds > 10
    || !Number.isFinite(values.capture_compress_after_hours) || values.capture_compress_after_hours < 0 || values.capture_compress_after_hours > 720
    || !Number.isFinite(values.capture_compress_min_mb) || values.capture_compress_min_mb < 1 || values.capture_compress_min_mb > 1024
    || !Number.isFinite(values.backup_keep) || values.backup_keep < 1 || values.backup_keep > 30) {
    showToast("请检查采集与存储参数的范围");
    return;
  }
  state.settings.saving = true;
  if (dom.settingsSaveButton) dom.settingsSaveButton.disabled = true;
  try {
    const { response, payload } = await fetchJson("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    }, { timeoutMs: 15000, allowInvalidJson: true });

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderSettingsPayload(payload);
    showToast(payload.message || "系统配置已保存");
  } catch (error) {
    showToast(`配置保存失败：${error.message || "请求失败"}`);
    if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = "保存失败";
  } finally {
    state.settings.saving = false;
    if (dom.settingsSaveButton) dom.settingsSaveButton.disabled = false;
  }
}

export async function runSettingsMaintenance(action) {
  const button = {
    metadata: dom.settingsMetadataCheckButton,
    repair: dom.settingsMetadataRepairButton,
    backup: dom.settingsBackupButton,
    integrity: dom.settingsIntegrityButton,
  }[action];
  if (button) button.disabled = true;
  try {
    if (action === "metadata" || action === "repair") {
      const apply = action === "repair";
      const result = await startMetadataSync(apply);
      if (result?.message && dom.settingsMaintenanceResult) dom.settingsMaintenanceResult.textContent = result.message;
    } else {
      const endpoint = action === "backup" ? "/api/settings/backup" : "/api/settings/integrity";
      const { response, payload } = await fetchJson(endpoint, { method: "POST" }, { timeoutMs: 120000, allowInvalidJson: true });

      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const message = payload.message || (action === "backup" ? "数据库备份完成" : "SQLite 完整性检查通过");
      if (dom.settingsMaintenanceResult) dom.settingsMaintenanceResult.textContent = message;
      showToast(message);
      await fetchSettings();
    }
  } catch (error) {
    if (dom.settingsMaintenanceResult) dom.settingsMaintenanceResult.textContent = error.message || "维护操作失败";
    showToast(`维护操作失败：${error.message || "请求失败"}`);
  } finally {
    if (button) button.disabled = false;
  }
}
