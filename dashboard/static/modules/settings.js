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
  if (dom.settingsCrownExtraMarkets) {
    dom.settingsCrownExtraMarkets.checked = config.crown_extra_markets_enabled ?? defaults.crown_extra_markets_enabled ?? true;
  }

  const readonly = payload?.readonly && typeof payload.readonly === "object" ? payload.readonly : {};
  const readonlyValue = (key, fallback = "--") => settingsValue(readonly[key], value(key, fallback));
  if (dom.settingsCapturePath) dom.settingsCapturePath.textContent = readonlyValue("capture_path", dom.settingsCapturePath.textContent || "--");
  if (dom.settingsDatabasePath) dom.settingsDatabasePath.textContent = readonlyValue("dashboard_db_path", dom.settingsDatabasePath.textContent || "--");
  if (dom.settingsBackupPath) dom.settingsBackupPath.textContent = readonlyValue("backup_dir", "--");
  if (dom.settingsCdpUrl) dom.settingsCdpUrl.textContent = readonlyValue("cdp_url", "--");
  if (dom.settingsCrownServiceUrl) dom.settingsCrownServiceUrl.textContent = readonlyValue("crown_service_url", "--");
  if (dom.settingsTargetHosts) {
    const hosts = readonlyValue("target_hosts", []);
    dom.settingsTargetHosts.textContent = Array.isArray(hosts) ? hosts.join("、") : String(hosts || "--");
  }
  if (dom.settingsChromeProfile) dom.settingsChromeProfile.textContent = readonlyValue("chrome_profile_dir", "--");
  if (dom.settingsStartUrl) dom.settingsStartUrl.textContent = readonlyValue("start_url", "--");
  if (dom.settingsPartnerBackend) dom.settingsPartnerBackend.textContent = readonlyValue("partner_backend_url", "--");
  if (dom.settingsPartnerOrdersDb) dom.settingsPartnerOrdersDb.textContent = readonlyValue("partner_orders_db_path", "--");
  if (dom.settingsPartnerAgents) {
    const agents = readonlyValue("partner_agents", []);
    const list = Array.isArray(agents) ? agents : String(agents || "").split(",").filter(Boolean);
    dom.settingsPartnerAgents.textContent = list.length ? list.join(" / ") : "--";
  }
  if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = payload?.message || "配置已读取";
  if (dom.settingsRestartNotice) {
    const pending = state.settings.restartRequired;
    dom.settingsRestartNotice.classList.toggle("hidden", pending.length === 0);
    dom.settingsRestartNotice.textContent = pending.length
      ? `有 ${pending.length} 项配置需要重启后生效：${pending.join("、")}`
      : "";
  }
  renderSettingsStatusFromSnapshot(state.snapshot);
  renderTelegramPayload(payload);
  for (const node of dom.settingsPage?.querySelectorAll(".settings-readonly-grid code") || []) {
    node.title = node.textContent;
  }
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
    await fetchTelegramStatus();
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
    crown_extra_markets_enabled: Boolean(dom.settingsCrownExtraMarkets?.checked ?? true),
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
  if (dom.settingsCrownExtraMarkets) dom.settingsCrownExtraMarkets.disabled = true;
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
    if (dom.settingsCrownExtraMarkets) dom.settingsCrownExtraMarkets.disabled = false;
  }
}

export async function saveCrownExtraMarketsSetting() {
  const checkbox = dom.settingsCrownExtraMarkets;
  if (!checkbox || state.settings.saving) return;
  const enabled = checkbox.checked;
  const previous = state.settings.config.crown_extra_markets_enabled
    ?? state.settings.defaults.crown_extra_markets_enabled
    ?? true;
  state.settings.saving = true;
  checkbox.disabled = true;
  if (dom.settingsSaveButton) dom.settingsSaveButton.disabled = true;
  if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = "正在保存皇冠附加盘设置…";
  try {
    const { response, payload } = await fetchJson("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ crown_extra_markets_enabled: enabled }),
    }, { timeoutMs: 15000, allowInvalidJson: true });

    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    state.settings.config.crown_extra_markets_enabled = enabled;
    if (dom.settingsSaveStatus) {
      dom.settingsSaveStatus.textContent = enabled ? "皇冠附加盘采集已开启" : "皇冠附加盘采集已关闭";
    }
    showToast(enabled ? "皇冠附加盘采集已开启" : "皇冠附加盘采集已关闭");
  } catch (error) {
    checkbox.checked = previous;
    if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = "保存失败";
    showToast(`皇冠附加盘设置保存失败：${error.message || "请求失败"}`);
  } finally {
    state.settings.saving = false;
    checkbox.disabled = false;
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
      // A full-size history database can take well over a minute to scan,
      // so the integrity check gets a longer client deadline than backup.
      const timeoutMs = action === "integrity" ? 300000 : 120000;
      const { response, payload } = await fetchJson(endpoint, { method: "POST" }, { timeoutMs, allowInvalidJson: true });

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

export function renderTelegramPayload(payload) {
  const telegram = payload?.telegram && typeof payload.telegram === "object" ? payload.telegram : {};
  const config = settingsConfigFromPayload(payload);
  const enabled = Boolean(config.telegram_enabled ?? telegram.enabled);
  const hasToken = Boolean(telegram.has_token ?? config.telegram_bot_token);
  const chatId = telegram.chat_id ?? config.telegram_chat_id ?? "";
  if (dom.settingsTelegramEnabled) dom.settingsTelegramEnabled.checked = enabled;
  if (dom.settingsTelegramChat) dom.settingsTelegramChat.value = chatId;
  if (dom.settingsTelegramProxy) dom.settingsTelegramProxy.value = telegram.proxy ?? config.telegram_proxy ?? "";
  if (dom.settingsTelegramToken) {
    dom.settingsTelegramToken.value = "";
    dom.settingsTelegramToken.placeholder = hasToken ? "已配置，留空保持不变" : "请填写机器人 Token";
  }
  if (dom.settingsTelegramState) {
    dom.settingsTelegramState.textContent = enabled ? "已启用" : "未启用";
  }
  if (dom.settingsTelegramConnect) {
    dom.settingsTelegramConnect.textContent = enabled
      ? `已启用${hasToken ? " · Token 已配置" : " · 缺少 Token"}`
      : "未启用";
  }
}

export function renderTelegramRecords(payload) {
  const box = dom.settingsTelegramRecords;
  if (!box) return;
  const records = Array.isArray(payload?.records) ? payload.records : [];
  box.replaceChildren();
  if (!records.length) {
    if (!payload?.enabled) {
      box.textContent = "推送未启用";
      return;
    }
    const alive = payload?.worker_alive;
    const pending = payload?.pending;
    const last = String(payload?.last_poll_at || "");
    if (alive === false) {
      box.textContent = "推送线程未运行，请重启看板服务";
    } else if (alive === true) {
      const clock = last ? last.slice(11, 19) : "";
      box.textContent = `推送线程运行中 · 待推送 ${pending ?? "—"} 条${clock ? ` · 最近检查 ${clock}` : ""}`;
    } else {
      box.textContent = "暂无推送记录";
    }
    return;
  }
  for (const record of records.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = `record ${record.status || ""}`;
    const time = document.createElement("span");
    time.textContent = record.created_at || "";
    const text = document.createElement("span");
    text.textContent = `${record.status === "sent" ? "成功" : "失败"} · ${record.message || ""}`;
    row.append(time, text);
    box.append(row);
  }
}

export async function fetchTelegramStatus() {
  try {
    const { response, payload } = await fetchJson(
      "/api/telegram/status", { cache: "no-store" },
      { timeoutMs: 8000, allowInvalidJson: true },
    );
    if (!response.ok || payload.ok === false) return;
    renderTelegramRecords(payload);
  } catch (_error) {
    // Status is informational; a transient error must not block the page.
  }
}

export async function saveTelegramSettings() {
  if (state.settings.saving) return;
  state.settings.saving = true;
  if (dom.settingsTelegramSave) dom.settingsTelegramSave.disabled = true;
  try {
    const body = {
      telegram_enabled: Boolean(dom.settingsTelegramEnabled?.checked),
      telegram_chat_id: dom.settingsTelegramChat?.value.trim() || "",
      telegram_proxy: dom.settingsTelegramProxy?.value.trim() || "",
    };
    const token = dom.settingsTelegramToken?.value.trim();
    if (token) body.telegram_bot_token = token;
    const { response, payload } = await fetchJson("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, { timeoutMs: 15000, allowInvalidJson: true });
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderSettingsPayload(payload);
    if (dom.settingsTelegramMessage) dom.settingsTelegramMessage.textContent = "推送设置已保存";
    showToast("TG 推送设置已保存");
    await fetchTelegramStatus();
  } catch (error) {
    if (dom.settingsTelegramMessage) dom.settingsTelegramMessage.textContent = `保存失败：${error.message}`;
    showToast(`TG 推送保存失败：${error.message || "请求失败"}`);
  } finally {
    state.settings.saving = false;
    if (dom.settingsTelegramSave) dom.settingsTelegramSave.disabled = false;
  }
}

export async function testTelegram() {
  if (dom.settingsTelegramTest) dom.settingsTelegramTest.disabled = true;
  if (dom.settingsTelegramMessage) dom.settingsTelegramMessage.textContent = "正在发送测试消息…";
  try {
    const { response, payload } = await fetchJson(
      "/api/telegram/test", { method: "POST" },
      { timeoutMs: 15000, allowInvalidJson: true },
    );
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (dom.settingsTelegramMessage) dom.settingsTelegramMessage.textContent = payload.message || "测试消息已发送";
    renderTelegramRecords(payload);
    showToast("测试消息已发送");
  } catch (error) {
    if (dom.settingsTelegramMessage) dom.settingsTelegramMessage.textContent = `发送失败：${error.message}`;
    showToast(`测试消息发送失败：${error.message || "请求失败"}`);
  } finally {
    if (dom.settingsTelegramTest) dom.settingsTelegramTest.disabled = false;
  }
}

export async function discoverTelegramChats() {
  if (dom.settingsTelegramChats) dom.settingsTelegramChats.disabled = true;
  const box = dom.settingsTelegramChatList;
  if (box) {
    box.replaceChildren();
    const loading = document.createElement("span");
    loading.className = "settings-section-meta";
    loading.textContent = "正在从 Telegram 读取可用的群/私聊…";
    box.append(loading);
  }
  try {
    const { response, payload } = await fetchJson(
      "/api/telegram/chats", { cache: "no-store" },
      { timeoutMs: 15000, allowInvalidJson: true },
    );
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!box) return;
    box.replaceChildren();
    const chats = Array.isArray(payload.chats) ? payload.chats : [];
    if (!chats.length) {
      const empty = document.createElement("span");
      empty.className = "settings-section-meta";
      empty.textContent = payload.hint || "没有可用的会话";
      box.append(empty);
      return;
    }
    for (const chat of chats) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-chat-option";
      button.textContent = `${chat.title} · ${chat.id}`;
      button.title = `填入 ${chat.id}`;
      button.addEventListener("click", () => {
        if (dom.settingsTelegramChat) dom.settingsTelegramChat.value = chat.id;
        if (dom.settingsTelegramMessage) dom.settingsTelegramMessage.textContent = `已填入 ${chat.title || chat.id}，保存后即可发送`;
      });
      box.append(button);
    }
  } catch (error) {
    if (box) {
      box.replaceChildren();
      const message = document.createElement("span");
      message.className = "settings-section-meta";
      message.textContent = `读取失败：${error.message || "请求失败"}`;
      box.append(message);
    }
  } finally {
    if (dom.settingsTelegramChats) dom.settingsTelegramChats.disabled = false;
  }
}
