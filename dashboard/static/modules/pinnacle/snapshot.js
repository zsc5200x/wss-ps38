import { fetchJson } from "../shared/http.js";
import { numberFormatter } from "../constants.js";
import { dom } from "../dom.js";
import { clearHistoryChart, renderHistoryControls } from "../history.js";
import { renderEvents, renderSelected } from "./events.js";
import { renderOdds, renderChanges } from "./markets.js";
import { renderSettingsStatusFromSnapshot } from "../settings-status.js";
import { showToast } from "../shared/dom.js";
import { formatClock, formatDuration, isFullTimeMarketRow } from "../shared/format.js";
import { state } from "../state.js";

export function setStatus(freshness) {
  dom.latencyBadge.className = "micro-badge";
  if (freshness === "offline") {
    dom.latencyBadge.classList.add("offline");
    dom.latencyBadge.textContent = "离线";
    return;
  }
  if (freshness === "live") {
    dom.latencyBadge.classList.add("live");
    dom.latencyBadge.textContent = "实时";
  } else if (freshness === "delayed") {
    dom.latencyBadge.classList.add("delayed");
    dom.latencyBadge.textContent = "延迟";
  } else if (freshness === "stale") {
    dom.latencyBadge.classList.add("stale");
    dom.latencyBadge.textContent = "停止";
  } else {
    dom.latencyBadge.classList.add("offline");
    dom.latencyBadge.textContent = "无数据";
  }
}

export function renderMetrics(snapshot) {
  const stats = snapshot.stats || {};
  dom.metricEvents.textContent = numberFormatter.format(stats.events || 0);
  dom.metricLive.textContent = `滚球 ${numberFormatter.format(stats.live || 0)}`;
  dom.metricToday.textContent = `今日待开 ${numberFormatter.format(stats.todayUpcoming || 0)}`;
  dom.metricQuotes.textContent = numberFormatter.format(stats.quotes || 0);
  dom.metricRows.textContent = `总行数 ${numberFormatter.format(stats.rows || 0)}`;
  dom.metricChanges.textContent = `变化 ${numberFormatter.format(stats.changes || 0)}`;
  dom.metricLatency.textContent = formatDuration(snapshot.lagSeconds);
  dom.metricServerTime.textContent = `服务器 ${formatClock(snapshot.serverTime)}`;
  const quality = stats.events
    ? ((stats.complete || 0) / stats.events) * 100
    : 0;
  dom.metricQuality.textContent = `${quality.toFixed(1)}%`;
  dom.metricPartial.textContent = `部分 ${numberFormatter.format(stats.partial || 0)}`;
  dom.metricMessages.textContent = `消息 ${numberFormatter.format(stats.messages || 0)}`;
  dom.sourceText.textContent = snapshot.source?.capturePath || "capture.jsonl";
  setStatus(snapshot.freshness);
}

export function applySnapshot(snapshot) {
  state.snapshot = snapshot;
  state.failures = 0;
  state.events = snapshot.events || [];
  state.odds = (snapshot.odds || []).filter(isFullTimeMarketRow);
  state.changes = (snapshot.changes || []).filter(isFullTimeMarketRow);
  state.eventId = snapshot.selectedEventId || state.eventId;
  state.selectedEvent = state.events.find((event) => event.id === state.eventId) || null;
  renderMetrics(snapshot);
  renderEvents();
  renderSelected();
  renderChanges();
  renderOdds();
  renderHistoryControls();
  renderSettingsStatusFromSnapshot(snapshot);
}

export async function refresh(force = false) {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const query = state.eventId
      ? `?event_id=${encodeURIComponent(state.eventId)}`
      : "";
    const { response, payload } = await fetchJson(`/api/snapshot${query}`, {
      cache: "no-store",
    }, { timeoutMs: 5000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applySnapshot(payload);
  } catch (error) {
    state.failures += 1;
    if (state.failures >= 2) {
      setStatus("offline");
    }
    if (force) showToast(`刷新失败：${error.message || "无法连接看板服务"}`);
  } finally {
    state.refreshing = false;
  }
}

export function selectEvent(eventId) {
  if (!eventId || eventId === state.eventId) return;
  state.eventId = eventId;
  state.selectedEvent = state.events.find((event) => event.id === eventId) || null;
  state.historyPoints = [];
  state.historySummary = null;
  state.historyRowKey = "";
  state.historyLastFetch = 0;
  state.historyRowsSignature = "";
  clearHistoryChart();
  const previousOdds = state.odds;
  state.odds = [];
  renderOdds();
  renderSelected();
  renderEvents();
  refresh(true).then(() => {
    if (!state.selectedEvent && previousOdds.length) {
      showToast("赛事数据暂不可用");
    }
  });
}
