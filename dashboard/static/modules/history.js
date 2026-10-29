import { fetchJson } from "./shared/http.js";
import { numberFormatter } from "./constants.js";
import { dom } from "./dom.js";
import { svgElement } from "./shared/dom.js";
import { parseDate, formatClock, formatPrice, historyHongKong, formatDelta, historyRowLabel } from "./shared/format.js";
import { state } from "./state.js";

export function clearHistoryChart() {
  dom.historyGrid.replaceChildren();
  dom.historyDots.replaceChildren();
  dom.historyArea.setAttribute("d", "");
  dom.historyLine.setAttribute("d", "");
  dom.historyLine.setAttribute("class", "history-line");
  dom.historyEmpty.classList.remove("hidden");
  dom.historyFirst.textContent = "—";
  dom.historyLast.textContent = "—";
  dom.historyHigh.textContent = "—";
  dom.historyLow.textContent = "—";
  dom.historyMove.textContent = "—";
  dom.historyMove.className = "";
  dom.historyRecordedAt.textContent = "仅记录实际香港赔率变化";
}

export function renderHistoryChart() {
  const points = state.historyPoints
    .map((point) => ({ ...point, hongKongValue: historyHongKong(point) }))
    .filter((point) => point.hongKongValue !== null);
  clearHistoryChart();
  if (!points.length) {
    dom.historyStatus.textContent = "SQLite · 暂无区间数据";
    return;
  }

  const width = 920;
  const height = 250;
  const margin = { left: 64, right: 22, top: 18, bottom: 36 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = points.map((point) => point.hongKongValue);
  const times = points.map((point, index) => {
    const parsed = parseDate(point.capturedAt);
    return parsed ? parsed.getTime() : index;
  });
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 0.0001) {
    min -= 0.01;
    max += 0.01;
  }
  const padding = (max - min) * 0.14;
  min -= padding;
  max += padding;
  const timeMin = times[0];
  const timeMax = times[times.length - 1];
  const timeSpan = Math.max(1, timeMax - timeMin);

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = margin.top + plotHeight * ratio;
    const value = max - (max - min) * ratio;
    dom.historyGrid.append(
      svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: y,
        y2: y,
        class: "history-grid-line",
      }),
      svgElement("text", {
        x: margin.left - 10,
        y: y + 4,
        class: "history-axis-label",
        "text-anchor": "end",
      })
    );
    dom.historyGrid.lastChild.textContent = value.toFixed(3);
  }

  const coordinates = points.map((point, index) => {
    const xRatio = points.length === 1 ? 0.5 : (times[index] - timeMin) / timeSpan;
    const yRatio = (max - point.hongKongValue) / (max - min);
    return {
      x: margin.left + plotWidth * xRatio,
      y: margin.top + plotHeight * yRatio,
    };
  });
  const linePath = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const last = coordinates[coordinates.length - 1];
  const first = coordinates[0];
  const areaPath = `${linePath} L${last.x.toFixed(2)} ${(margin.top + plotHeight).toFixed(2)} L${first.x.toFixed(2)} ${(margin.top + plotHeight).toFixed(2)} Z`;
  const direction = values[values.length - 1] > values[0]
    ? "up"
    : values[values.length - 1] < values[0] ? "down" : "flat";
  dom.historyArea.setAttribute("d", areaPath);
  dom.historyLine.setAttribute("d", linePath);
  dom.historyLine.setAttribute("class", `history-line ${direction}`);
  dom.historyEmpty.classList.add("hidden");

  const sampled = coordinates.filter((_, index) => index === 0 || index === coordinates.length - 1 || index % Math.max(1, Math.ceil(coordinates.length / 28)) === 0);
  for (const [index, point] of sampled.entries()) {
    dom.historyDots.append(
      svgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: index === sampled.length - 1 ? 4.2 : 2.4,
        class: index === sampled.length - 1 ? "history-dot current" : "history-dot",
      })
    );
  }

  const summary = state.historySummary || {};
  const move = values[values.length - 1] - values[0];
  dom.historyStatus.textContent = `SQLite · ${numberFormatter.format(summary.count || points.length)} 个变化点`;
  dom.historyFirst.textContent = formatPrice(values[0], 4);
  dom.historyLast.textContent = formatPrice(values[values.length - 1], 4);
  dom.historyHigh.textContent = formatPrice(Math.max(...values), 4);
  dom.historyLow.textContent = formatPrice(Math.min(...values), 4);
  dom.historyMove.textContent = formatDelta(move);
  dom.historyMove.className = move > 0 ? "up" : move < 0 ? "down" : "flat";
  dom.historyRecordedAt.textContent = `更新于 ${formatClock(points[points.length - 1].capturedAt)} · ${state.historyTruncated ? "仅显示最近点" : "完整区间"}`;
  dom.historyChart.setAttribute("aria-label", `香港赔率历史走势，从 ${values[0].toFixed(3)} 到 ${values[values.length - 1].toFixed(3)}`);
}

export function renderHistoryControls() {
  const rows = state.odds.slice().sort((a, b) => (
    `${a.market}:${a.stage}:${a.option}:${a.line}`.localeCompare(`${b.market}:${b.stage}:${b.option}:${b.line}`)
  ));
  const signature = `${state.eventId}::${rows.map((row) => row.key).join("|")}`;
  if (signature !== state.historyRowsSignature) {
    state.historyRowsSignature = signature;
    let selected = rows.find((row) => row.key === state.historyRowKey);
    if (!selected) {
      selected = rows.find((row) => row.direction === "up" || row.direction === "down")
        || rows.find((row) => row.quoted)
        || rows[0];
    }
    state.historyRowKey = selected?.key || "";
    dom.historyRowSelect.replaceChildren();
    if (!rows.length) {
      const option = new Option("当前赛事暂无盘口", "");
      dom.historyRowSelect.append(option);
      dom.historyRowSelect.disabled = true;
      state.historyPoints = [];
      state.historySummary = null;
      renderHistoryChart();
    } else {
      dom.historyRowSelect.disabled = false;
      for (const row of rows) {
        const option = new Option(historyRowLabel(row, state.selectedEvent?.name), row.key);
        dom.historyRowSelect.append(option);
      }
      dom.historyRowSelect.value = state.historyRowKey;
    }
  }
  dom.historyRefreshButton.disabled = !state.historyRowKey || state.historyLoading;
  if (!state.historyRowKey) return;
  if (!state.historyPoints.length || Date.now() - state.historyLastFetch > 4200) {
    fetchHistory();
  }
}

export async function fetchHistory(force = false) {
  if (!state.eventId || !state.historyRowKey) return;
  if (!force && Date.now() - state.historyLastFetch < 2200) return;
  const row = state.odds.find((item) => item.key === state.historyRowKey);
  if (!row) return;
  state.historyLastFetch = Date.now();
  state.historyLoading = true;
  const requestSerial = ++state.historyRequestSerial;
  dom.historyRefreshButton.disabled = true;
  dom.historyStatus.textContent = "SQLite · 查询中…";
  dom.historyError.classList.add("hidden");
  const query = new URLSearchParams({
    event_id: state.eventId,
    hours: String(state.historyHours),
    limit: "5000",
    stage: row.stage || "",
    market: row.market || "",
    option: row.option || "",
    line: row.line || "",
  });
  try {
    const { response, payload } = await fetchJson(`/api/history?${query}`, {
      cache: "no-store",
    }, { timeoutMs: 8000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    if (requestSerial !== state.historyRequestSerial) return;
    state.historyPoints = payload.points || [];
    state.historySummary = payload.summary || null;
    state.historyTruncated = Boolean(payload.truncated);
    state.historyDatabase = payload.database || null;
    renderHistoryChart();
    if (payload.database?.errors) {
      dom.historyError.textContent = `数据库写入异常 ${payload.database.errors} 次`;
      dom.historyError.classList.remove("hidden");
    }
  } catch (error) {
    if (requestSerial !== state.historyRequestSerial) return;
    dom.historyStatus.textContent = "SQLite · 查询失败";
    dom.historyError.textContent = `历史数据加载失败：${error.name === "AbortError" ? "请求超时" : (error.message || "未知错误")}`;
    dom.historyError.classList.remove("hidden");
  } finally {
    if (requestSerial === state.historyRequestSerial) {
      state.historyLoading = false;
      dom.historyRefreshButton.disabled = !state.historyRowKey;
    }
  }
}
