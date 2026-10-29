import { fetchJson } from "./shared/http.js";
import { numberFormatter } from "./constants.js";
import { dom } from "./dom.js";
import { refresh } from "./pinnacle/snapshot.js";
import { showToast } from "./shared/dom.js";
import { formatShortDate } from "./shared/format.js";
import { state } from "./state.js";

export function renderMetadataStatus(status) {
  const previousStatus = state.metadataStatus;
  state.metadataStatus = status || {};
  const current = status?.current || {};
  const missing = Number(current.missing || 0);
  const total = Number(status?.total || 0);
  const processed = Number(status?.processed || 0);
  const failed = Number(status?.failed || 0);
  const running = Boolean(status?.running);
  const exitCode = status?.processExitCode;
  const hasError = !running && exitCode !== null && exitCode !== undefined && exitCode !== 0;

  dom.metadataMaintenance.classList.toggle("running", running);
  dom.metadataMaintenance.classList.toggle("has-error", hasError);
  dom.metadataCheckButton.disabled = running || state.metadataRequesting;
  dom.metadataRepairButton.disabled = running || state.metadataRequesting || missing === 0;

  let summary = `缺失 ${numberFormatter.format(missing)} 场`;
  if (running) {
    summary = total
      ? `正在处理 ${numberFormatter.format(processed)}/${numberFormatter.format(total)}`
      : "正在连接平博页面";
  } else if (missing === 0) {
    summary = "缺失 0 · 元数据完整";
  } else if (status?.message) {
    summary = `缺失 ${numberFormatter.format(missing)} 场 · 可检查`;
  }
  dom.metadataSyncSummary.textContent = summary;

  const progress = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
  dom.metadataProgress.hidden = total === 0;
  dom.metadataProgressBar.style.width = `${progress}%`;
  dom.metadataProgressBar.parentElement.setAttribute(
    "aria-label",
    total ? `元数据任务进度 ${Math.round(progress)}%` : "元数据任务进度"
  );

  let detail = status?.message || "等待第一次元数据检查";
  if (running && total) {
    detail = `${detail} · 成功 ${numberFormatter.format(status.resolved || 0)} · 失败 ${numberFormatter.format(failed)}`;
  } else if (!running && status?.finishedAt && !hasError) {
    detail = `${detail} · ${formatShortDate(status.finishedAt)}`;
  }
  dom.metadataSyncDetail.textContent = detail;
  if (dom.settingsMaintenanceSummary) dom.settingsMaintenanceSummary.textContent = summary;
  if (dom.settingsMaintenanceDetail) dom.settingsMaintenanceDetail.textContent = detail;
  if (dom.settingsMetadataState && !state.snapshot) {
    dom.settingsMetadataState.textContent = missing ? `缺失 ${numberFormatter.format(missing)}` : "完整";
    dom.settingsMetadataState.className = missing ? "settings-state-warn" : "settings-state-good";
    dom.settingsMetadataDetail.textContent = running ? detail : `已处理 ${numberFormatter.format(processed)} 场`;
  }

  const justFinished = state.metadataWasRunning && !running;
  state.metadataWasRunning = running;
  if (justFinished) {
    if (hasError) {
      showToast("元数据任务失败，请查看 logs/metadata_sync.log");
    } else if (status?.message) {
      showToast(status.message);
    }
    refresh(true);
  } else if (previousStatus && running && !previousStatus.running) {
    showToast("元数据任务已开始");
  }
}

export async function fetchMetadataStatus(showError = false) {
  if (state.metadataStatusLoading) return;
  state.metadataStatusLoading = true;
  try {
    const { response, payload } = await fetchJson("/api/metadata/status", {
      cache: "no-store",
    }, { timeoutMs: 5000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderMetadataStatus(payload);
  } catch (error) {
    if (showError) showToast(`元数据状态读取失败：${error.message || "请求失败"}`);
    dom.metadataSyncDetail.textContent = "无法读取元数据任务状态";
    dom.metadataMaintenance.classList.add("has-error");
  } finally {
    state.metadataStatusLoading = false;
  }
}

export async function startMetadataSync(apply) {
  if (state.metadataRequesting) return null;
  const missing = Number(state.metadataStatus?.current?.missing || 0);
  if (apply && missing > 0) {
    const confirmed = window.confirm(
      `将为 ${numberFormatter.format(missing)} 场缺失赛事访问平博页面并写入 SQLite / events_list.csv。继续吗？`
    );
    if (!confirmed) return null;
  }

  state.metadataRequesting = true;
  dom.metadataCheckButton.disabled = true;
  dom.metadataRepairButton.disabled = true;
  try {
    const { response, payload } = await fetchJson("/api/metadata/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply }),
    }, { timeoutMs: 5000, allowInvalidJson: true });

    if (!response.ok && response.status !== 409) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    if (payload.status) renderMetadataStatus(payload.status);
    showToast(payload.message || (apply ? "已启动一键补全" : "已启动缺失检查"));
    await fetchMetadataStatus();
    return payload;
  } catch (error) {
    showToast(`${apply ? "补全" : "检查"}任务启动失败：${error.message || "请求失败"}`);
    throw error;
  } finally {
    state.metadataRequesting = false;
    const status = state.metadataStatus || {};
    const currentMissing = Number(status.current?.missing || 0);
    dom.metadataCheckButton.disabled = Boolean(status.running);
    dom.metadataRepairButton.disabled = Boolean(status.running) || currentMissing === 0;
  }
}
