(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const numberFormatter = new Intl.NumberFormat("zh-CN");
  const POLL_INTERVAL = 1400;

  const dom = {
    connectionPill: $("connectionPill"),
    connectionText: $("connectionText"),
    lastCapture: $("lastCapture"),
    primaryNav: $("primaryNav"),
    pagePanels: [...document.querySelectorAll("[data-page-panel]")],
    pauseButton: $("pauseButton"),
    refreshButton: $("refreshButton"),
    crownFrame: $("crownFrame"),
    metadataMaintenance: $("metadataMaintenance"),
    metadataCheckButton: $("metadataCheckButton"),
    metadataRepairButton: $("metadataRepairButton"),
    metadataSyncSummary: $("metadataSyncSummary"),
    metadataSyncDetail: $("metadataSyncDetail"),
    metadataProgress: $("metadataProgress"),
    metadataProgressBar: $("metadataProgressBar"),
    metricEvents: $("metricEvents"),
    metricLive: $("metricLive"),
    metricToday: $("metricToday"),
    metricQuotes: $("metricQuotes"),
    metricRows: $("metricRows"),
    metricChanges: $("metricChanges"),
    metricLatency: $("metricLatency"),
    latencyBadge: $("latencyBadge"),
    metricServerTime: $("metricServerTime"),
    metricQuality: $("metricQuality"),
    metricPartial: $("metricPartial"),
    metricMessages: $("metricMessages"),
    eventCount: $("eventCount"),
    eventSearch: $("eventSearch"),
    metadataFilters: $("metadataFilters"),
    sortSelect: $("sortSelect"),
    eventList: $("eventList"),
    selectedName: $("selectedName"),
    selectedLeague: $("selectedLeague"),
    selectedScore: $("selectedScore"),
    selectedClock: $("selectedClock"),
    selectedKickoff: $("selectedKickoff"),
    selectedQuality: $("selectedQuality"),
    selectedQuotes: $("selectedQuotes"),
    selectedChanged: $("selectedChanged"),
    historyPanel: $("historyPanel"),
    historyToggle: $("historyToggle"),
    historyContent: $("historyContent"),
    historyRowSelect: $("historyRowSelect"),
    historyRangeSelect: $("historyRangeSelect"),
    historyRefreshButton: $("historyRefreshButton"),
    historyStatus: $("historyStatus"),
    historyRecordedAt: $("historyRecordedAt"),
    historyFirst: $("historyFirst"),
    historyLast: $("historyLast"),
    historyHigh: $("historyHigh"),
    historyLow: $("historyLow"),
    historyMove: $("historyMove"),
    historyChart: $("historyChart"),
    historyGrid: $("historyGrid"),
    historyArea: $("historyArea"),
    historyLine: $("historyLine"),
    historyDots: $("historyDots"),
    historyEmpty: $("historyEmpty"),
    historyError: $("historyError"),
    changesPanel: $("changesPanel"),
    changesToggle: $("changesToggle"),
    changesContent: $("changesContent"),
    changeCount: $("changeCount"),
    changeFeed: $("changeFeed"),
    marketTabs: $("marketTabs"),
    marketGroups: $("marketGroups"),
    marketQuotes: $("marketQuotes"),
    marketFresh: $("marketFresh"),
    marketLastUpdate: $("marketLastUpdate"),
    oddsEmpty: $("oddsEmpty"),
    oddsBoard: $("oddsBoard"),
    sourceText: $("sourceText"),
    toast: $("toast"),
  };

  const state = {
    eventId: "",
    events: [],
    selectedEvent: null,
    odds: [],
    changes: [],
    filter: "all",
    search: "",
    sort: "stable",
    collapsedLeagues: new Set(),
    collapsedScopes: { live: false, today: false },
    market: "all",
    paused: false,
    crownPaused: false,
    refreshing: false,
    failures: 0,
    snapshot: null,
    rowPrices: new Map(),
    eventNodes: new Map(),
    eventsSignature: "",
    changesSignature: "",
    historyRowKey: "",
    historyHours: 24,
    historyPoints: [],
    historySummary: null,
    historyTruncated: false,
    historyDatabase: null,
    historyLoading: false,
    historyLastFetch: 0,
    historyRequestSerial: 0,
    historyRowsSignature: "",
    toastTimer: null,
    metadataStatus: null,
    metadataStatusLoading: false,
    metadataRequesting: false,
    metadataWasRunning: false,
    currentPage: "home",
  };


  function el(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== "") node.textContent = text;
    return node;
  }

  function iconArrow(direction) {
    if (direction === "up") return "↑";
    if (direction === "down") return "↓";
    return "•";
  }

  function setupSectionCollapse(panel, toggle, content, storageKey) {
    if (!panel || !toggle || !content) return;

    const applyCollapsed = (collapsed, persist = true) => {
      panel.classList.toggle("is-collapsed", collapsed);
      content.hidden = collapsed;
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.title = collapsed ? "展开" : "收起";
      if (persist) {
        try {
          window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
        } catch (_error) {
          // Private browsing or a restricted storage policy should not block UI.
        }
      }
    };

    let initiallyCollapsed = false;
    try {
      initiallyCollapsed = window.localStorage.getItem(storageKey) === "1";
    } catch (_error) {
      initiallyCollapsed = false;
    }
    applyCollapsed(initiallyCollapsed, false);
    toggle.addEventListener("click", () => {
      applyCollapsed(toggle.getAttribute("aria-expanded") === "true");
    });
  }

  function parseDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function leagueDisplayName(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    // PS3838 uses "国家 - 联赛" as the display separator. Keep hyphens
    // inside competition names such as "U-20" or "I-League".
    return text.replace(/^(.{2,}?)\s*[-–—]\s*(.+)$/, "$1$2");
  }

  function formatClock(value) {
    const parsed = parseDate(value);
    if (!parsed) return "--:--:--";
    return parsed.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatShortDate(value) {
    const parsed = parseDate(value);
    if (!parsed) return "--";
    return parsed.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatKickoff(value) {
    if (!value) return "开赛时间未知";
    const parsed = parseDate(value.replace(" ", "T"));
    if (!parsed) return value;
    return parsed.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return "无数据";
    if (seconds < 1) return "<1 秒";
    if (seconds < 60) return `${Math.round(seconds)} 秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
  }

  function formatPrice(value, digits = 3) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "—";
    }
    return Number(value).toFixed(digits);
  }

  function numericValue(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function rowHongKong(row) {
    const hongKong = numericValue(row?.hongKong);
    if (hongKong !== null) return hongKong;
    const decimal = numericValue(row?.decimal);
    return decimal === null ? null : decimal - 1;
  }

  function historyHongKong(point) {
    const hongKong = numericValue(point?.hongKong);
    if (hongKong !== null) return hongKong;
    let decimal = numericValue(point?.decimal);
    if (decimal === null) decimal = numericValue(point?.v);
    return decimal === null ? null : decimal - 1;
  }

  function decimalToHongKong(value) {
    const decimal = numericValue(value);
    return decimal === null ? null : decimal - 1;
  }

  function formatDelta(value) {
    if (value === null || value === undefined) return "";
    const number = Number(value);
    if (number > 0) return `+${number.toFixed(3)}`;
    return number.toFixed(3);
  }

  function matchPeriodLabel(value) {
    return {
      "1H": "上半场",
      "2H": "下半场",
      HT: "中场",
      FT: "完场",
      ET: "加时",
      PEN: "点球",
    }[String(value || "").toUpperCase()] || String(value || "");
  }

  function matchClockLabel(event) {
    const parts = [];
    if (event?.matchMinute) parts.push(String(event.matchMinute));
    const period = matchPeriodLabel(event?.matchPeriod);
    if (period) parts.push(period);
    return parts.join(" · ");
  }

  function quoteAgeInfo(value) {
    const captured = parseDate(value);
    const reference = parseDate(state.snapshot?.serverTime) || new Date();
    if (!captured) return { text: "时间未知", level: "unknown", seconds: null };
    const seconds = Math.max(0, Math.round((reference.getTime() - captured.getTime()) / 1000));
    if (seconds <= 10) return { text: "刚刚", level: "live", seconds };
    if (seconds < 60) return { text: `${seconds} 秒前`, level: "live", seconds };
    if (seconds < 3600) {
      return {
        text: `${Math.floor(seconds / 60)} 分前`,
        level: seconds < 300 ? "recent" : "aged",
        seconds,
      };
    }
    return {
      text: `${Math.floor(seconds / 3600)} 小时前`,
      level: "aged",
      seconds,
    };
  }

  function handicapSideLine(row) {
    const line = Number(row?.line);
    if (!Number.isFinite(line)) return null;
    return String(row.option) === "0" ? line : -line;
  }

  function countMarketGroups(rows) {
    let count = rows.some((row) => String(row.market) === "1") ? 1 : 0;
    const handicapLines = new Set();
    const totalLines = new Set();
    for (const row of rows) {
      if (String(row.market) === "2") {
        const line = handicapSideLine(row);
        if (line !== null) handicapLines.add(line.toFixed(4));
      }
      if (String(row.market) === "3") {
        const line = Number(row.line);
        if (Number.isFinite(line)) totalLines.add(line.toFixed(4));
      }
    }
    return count + handicapLines.size + totalLines.size;
  }

  function qualityLabel(status) {
    return {
      complete: "元数据完整",
      partial: "元数据部分缺失",
      missing: "元数据缺失",
    }[status] || "元数据未知";
  }

  function marketLabel(code) {
    return {
      1: "胜平负",
      2: "让球",
      3: "大小球",
    }[code] || `盘口 ${code || "—"}`;
  }

  function isFullTimeMarketRow(row) {
    return String(row.stage) === "0" && ["1", "2", "3"].includes(String(row.market));
  }

  function stageLabel(code) {
    return {
      0: "全场",
      1: "上半场",
      2: "下半场",
    }[code] || `阶段 ${code || "—"}`;
  }

  function formatLineNumber(value) {
    if (value === null || value === undefined || value === "") return "—";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    const rounded = number.toFixed(2).replace(/\.?0+$/, "");
    return rounded === "-0" ? "0" : rounded;
  }

  function formatHandicapLine(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return formatLineNumber(value);
    if (Math.abs(number) < 0.000001) return "0";
    return `${number > 0 ? "+" : ""}${formatLineNumber(number)}`;
  }

  function formatTotalLine(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return formatLineNumber(value);
    const quarterSteps = number * 4;
    const roundedSteps = Math.round(quarterSteps);
    if (Math.abs(quarterSteps - roundedSteps) < 0.000001 && Math.abs(roundedSteps) % 2 === 1) {
      return `${formatLineNumber(number - 0.25)}/${formatLineNumber(number + 0.25)}`;
    }
    return formatLineNumber(number);
  }

  function teamNames(eventName) {
    const parts = String(eventName || "").split(/\s+VS\s+/i);
    return [parts[0] || "主队", parts[1] || "客队"];
  }

  function selectionLabel(row, eventName) {
    const [home, away] = teamNames(eventName);
    if (String(row.market) === "1") {
      return {
        primary: { 0: "主胜", 1: "和局", 2: "客胜" }[String(row.option)] || `选项 ${row.option}`,
        detail: { 0: home, 1: "双方打平", 2: away }[String(row.option)] || "独赢",
        line: "—",
      };
    }
    if (String(row.market) === "2") {
      const isHome = String(row.option) === "0";
      const lineNumber = Number(row.line);
      const sideLine = isHome ? lineNumber : -lineNumber;
      const line = formatHandicapLine(sideLine);
      const role = !Number.isFinite(sideLine) || Math.abs(sideLine) < 0.000001
        ? `${isHome ? "主队" : "客队"}平手`
        : sideLine < 0
          ? `${isHome ? "主队" : "客队"}让球`
          : `${isHome ? "主队" : "客队"}受让`;
      return {
        primary: `${isHome ? home : away} ${line}`,
        detail: role,
        line,
      };
    }
    if (String(row.market) === "3") {
      const line = formatTotalLine(row.line);
      const isOver = String(row.option) === "3";
      return {
        primary: `${isOver ? "大" : "小"}${line}`,
        detail: "总进球",
        line,
      };
    }
    return {
      primary: `选项 ${row.option || "—"}`,
      detail: "未知玩法",
      line: formatLineNumber(row.line),
    };
  }

  function historyRowLabel(row) {
    const label = selectionLabel(row, state.selectedEvent?.name);
    return `${marketLabel(row.market)} · ${stageLabel(row.stage)} · ${label.primary}`;
  }

  function svgElement(tag, attributes = {}) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) {
      node.setAttribute(name, String(value));
    }
    return node;
  }

  function clearHistoryChart() {
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

  function renderHistoryChart() {
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

  function renderHistoryControls() {
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
          const option = new Option(historyRowLabel(row), row.key);
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

  async function fetchHistory(force = false) {
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
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
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
      const response = await fetch(`/api/history?${query}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
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
      window.clearTimeout(timer);
      if (requestSerial === state.historyRequestSerial) {
        state.historyLoading = false;
        dom.historyRefreshButton.disabled = !state.historyRowKey;
      }
    }
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      dom.toast.classList.remove("visible");
    }, 3000);
  }

  function resolvePage(value) {
    return ["home", "pinnacle", "crown"].includes(value) ? value : "home";
  }

  function ensureCrownFrameLoaded() {
    if (!dom.crownFrame || dom.crownFrame.dataset.loaded === "true") return;
    const source = dom.crownFrame.dataset.src;
    if (!source) return;
    dom.crownFrame.dataset.loaded = "true";
    dom.crownFrame.src = source;
  }

  function postCrownCommand(command, payload = {}) {
    if (!dom.crownFrame?.contentWindow) return;
    dom.crownFrame.contentWindow.postMessage(
      { type: "crown:command", command, ...payload },
      location.origin,
    );
  }

  function updateRefreshControls() {
    const paused = state.currentPage === "crown" ? state.crownPaused : state.paused;
    dom.pauseButton.setAttribute("aria-pressed", String(paused));
    dom.pauseButton.setAttribute("aria-label", paused ? "继续自动刷新" : "暂停自动刷新");
    dom.pauseButton.querySelector("span").textContent = paused ? "继续刷新" : "暂停刷新";
  }

  function showPage(page, updateLocation = true) {
    const target = resolvePage(page);
    state.currentPage = target;
    document.body.classList.toggle("crown-mode", target === "crown");
    for (const button of dom.primaryNav.querySelectorAll("[data-page]")) {
      const active = button.dataset.page === target;
      button.classList.toggle("active", active);
      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    }
    for (const panel of dom.pagePanels) {
      panel.classList.toggle("hidden", panel.dataset.pagePanel !== target);
    }
    if (target === "crown") ensureCrownFrameLoaded();
    updateRefreshControls();
    document.title = target === "home"
      ? "数据工作台"
      : (target === "pinnacle" ? "平博数据" : "皇冠数据");
    if (updateLocation) {
      const nextHash = target === "home" ? "" : `#${target}`;
      history.replaceState(null, "", `${location.pathname}${location.search}${nextHash}`);
    }
    window.scrollTo(0, 0);
  }

  function setStatus(freshness, paused = false) {
    dom.connectionPill.className = "status-pill";
    dom.latencyBadge.className = "micro-badge";
    if (paused) {
      dom.connectionPill.classList.add("delayed");
      dom.latencyBadge.classList.add("delayed");
      dom.connectionText.textContent = "刷新已暂停";
      dom.latencyBadge.textContent = "暂停";
      return;
    }
    if (freshness === "offline") {
      dom.connectionPill.classList.add("offline");
      dom.latencyBadge.classList.add("offline");
      dom.connectionText.textContent = "看板服务离线";
      dom.latencyBadge.textContent = "离线";
      return;
    }
    if (freshness === "live") {
      dom.connectionPill.classList.add("live");
      dom.latencyBadge.classList.add("live");
      dom.connectionText.textContent = "实时接收中";
      dom.latencyBadge.textContent = "实时";
    } else if (freshness === "delayed") {
      dom.connectionPill.classList.add("delayed");
      dom.latencyBadge.classList.add("delayed");
      dom.connectionText.textContent = "数据轻微延迟";
      dom.latencyBadge.textContent = "延迟";
    } else if (freshness === "stale") {
      dom.connectionPill.classList.add("stale");
      dom.latencyBadge.classList.add("stale");
      dom.connectionText.textContent = "数据已停止更新";
      dom.latencyBadge.textContent = "停止";
    } else {
      dom.connectionPill.classList.add("offline");
      dom.latencyBadge.classList.add("offline");
      dom.connectionText.textContent = "等待数据";
      dom.latencyBadge.textContent = "无数据";
    }
  }

  function renderMetrics(snapshot) {
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
    dom.lastCapture.textContent = formatClock(snapshot.source?.lastCapturedAt);
    dom.sourceText.textContent = snapshot.source?.capturePath || "capture.jsonl";
    setStatus(snapshot.freshness, state.paused);
  }

  function renderMetadataStatus(status) {
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

  async function fetchMetadataStatus(showError = false) {
    if (state.metadataStatusLoading) return;
    state.metadataStatusLoading = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/api/metadata/status", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderMetadataStatus(await response.json());
    } catch (error) {
      if (showError) showToast(`元数据状态读取失败：${error.message || "请求失败"}`);
      dom.metadataSyncDetail.textContent = "无法读取元数据任务状态";
      dom.metadataMaintenance.classList.add("has-error");
    } finally {
      window.clearTimeout(timer);
      state.metadataStatusLoading = false;
    }
  }

  async function startMetadataSync(apply) {
    if (state.metadataRequesting) return;
    const missing = Number(state.metadataStatus?.current?.missing || 0);
    if (apply && missing > 0) {
      const confirmed = window.confirm(
        `将为 ${numberFormatter.format(missing)} 场缺失赛事访问平博页面并写入 SQLite / events_list.csv。继续吗？`
      );
      if (!confirmed) return;
    }

    state.metadataRequesting = true;
    dom.metadataCheckButton.disabled = true;
    dom.metadataRepairButton.disabled = true;
    try {
      const response = await fetch("/api/metadata/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      if (payload.status) renderMetadataStatus(payload.status);
      showToast(payload.message || (apply ? "已启动一键补全" : "已启动缺失检查"));
      await fetchMetadataStatus();
    } catch (error) {
      showToast(`${apply ? "补全" : "检查"}任务启动失败：${error.message || "请求失败"}`);
    } finally {
      state.metadataRequesting = false;
      const status = state.metadataStatus || {};
      const currentMissing = Number(status.current?.missing || 0);
      dom.metadataCheckButton.disabled = Boolean(status.running);
      dom.metadataRepairButton.disabled = Boolean(status.running) || currentMissing === 0;
    }
  }

  function eventMatches(event) {
    if (state.filter !== "all" && event.metadataStatus !== state.filter) {
      return false;
    }
    if (!state.search) return true;
    const haystack = [
      event.name,
      event.league,
      leagueDisplayName(event.league),
      event.id,
      event.kickoff,
    ].join(" ").toLowerCase();
    return haystack.includes(state.search);
  }

  const leagueCollator = new Intl.Collator("zh-CN", {
    numeric: true,
    sensitivity: "base",
  });

  function scopeRank(event) {
    return event.scope === "live" ? 0 : 1;
  }

  function sortedEvents(events) {
    const filtered = events.filter(eventMatches);
    filtered.sort((a, b) => {
      const scope = scopeRank(a) - scopeRank(b);
      if (scope !== 0) return scope;
      if (state.sort === "name") {
        return (a.name || "").localeCompare(b.name || "", "zh-CN");
      }
      const ak = a.kickoff || "9999";
      const bk = b.kickoff || "9999";
      const kickoff = ak.localeCompare(bk);
      if (kickoff !== 0) return kickoff;
      return (a.name || "").localeCompare(b.name || "", "zh-CN");
    });
    return filtered;
  }

  function groupEventsByLeague(events) {
    const groups = new Map();
    for (const event of events) {
      const scope = event.scope === "live" ? "live" : "today";
      const league = leagueDisplayName(event.league) || "联赛未知";
      const key = `${scope}\u0000${league}`;
      if (!groups.has(key)) groups.set(key, { scope, league, events: [] });
      groups.get(key).events.push(event);
    }
    return Array.from(groups.values())
      .sort((a, b) => {
        if (a.scope !== b.scope) return a.scope === "live" ? -1 : 1;
        if (state.sort === "kickoff") {
          const kickoff = (a.events[0]?.kickoff || "9999")
            .localeCompare(b.events[0]?.kickoff || "9999");
          if (kickoff !== 0) return kickoff;
        }
        return leagueCollator.compare(a.league, b.league);
      });
  }

  function formatKickoffParts(value) {
    const parsed = value ? parseDate(String(value).replace(" ", "T")) : null;
    if (!parsed) return { time: "--:--", date: "日期未知" };
    return {
      time: parsed.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      date: `${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}`,
    };
  }

  function periodLabel(code) {
    return {
      "1H": "上半场",
      "2H": "下半场",
      HT: "中场",
      ET: "加时",
      PEN: "点球",
    }[String(code || "").toUpperCase()] || "进行中";
  }

  function createEventItem(event) {
    const button = el("button", "event-item");
    button.type = "button";
    button.dataset.eventId = event.id;
    button.setAttribute("aria-pressed", String(event.id === state.eventId));

    const stateBox = el("span", "event-state");
    const stateMain = el("span", "event-state-main");
    const stateSub = el("span", "event-state-sub");
    stateBox.append(stateMain, stateSub);

    const teams = el("span", "event-teams");
    const home = el("span", "event-team");
    const away = el("span", "event-team");
    teams.append(home, away);

    const score = el("span", "event-score");
    const scoreHome = el("span", "event-score-value");
    const scoreAway = el("span", "event-score-value");
    score.append(scoreHome, scoreAway);

    const meta = el("span", "event-item-meta");
    const dot = el("span", "quality-dot");
    const scope = el("span", "event-scope");
    const quotes = el("span", "event-item-quotes");
    const updated = el("span", "event-item-updated");
    meta.append(dot, scope, quotes, updated);

    button.append(stateBox, teams, score, meta);
    button.eventNodes = {
      stateBox,
      stateMain,
      stateSub,
      home,
      away,
      score,
      scoreHome,
      scoreAway,
      dot,
      scope,
      quotes,
      updated,
    };
    state.eventNodes.set(event.id, button);
    updateEventItem(button, event);
    return button;
  }

  function setText(node, value) {
    const text = String(value ?? "");
    if (node.textContent !== text) node.textContent = text;
  }

  function updateEventItem(button, event) {
    const nodes = button.eventNodes;
    if (!nodes) return;
    const isLive = event.scope === "live";
    const [home, away] = teamNames(event.name);
    const kickoff = formatKickoffParts(event.kickoff);
    const hasScore = isLive
      && event.scoreHome !== null
      && event.scoreHome !== undefined
      && event.scoreHome !== ""
      && event.scoreAway !== null
      && event.scoreAway !== undefined
      && event.scoreAway !== "";

    button.setAttribute("aria-pressed", String(event.id === state.eventId));
    button.classList.toggle("selected", event.id === state.eventId);
    button.classList.toggle("is-live", isLive);
    button.title = `${event.name}\n${leagueDisplayName(event.league) || "联赛未知"}`;

    nodes.stateBox.classList.toggle("live", isLive);
    setText(
      nodes.stateMain,
      isLive ? (event.matchMinute || "LIVE") : kickoff.time
    );
    setText(
      nodes.stateSub,
      isLive ? periodLabel(event.matchPeriod) : kickoff.date
    );
    setText(nodes.home, home);
    setText(nodes.away, away);
    nodes.score.hidden = !hasScore;
    setText(nodes.scoreHome, hasScore ? event.scoreHome : "");
    setText(nodes.scoreAway, hasScore ? event.scoreAway : "");
    nodes.dot.className = `quality-dot ${event.metadataStatus || "missing"}`;
    nodes.scope.className = `event-scope ${event.scope || "today"}`;
    setText(nodes.scope, isLive ? "滚球" : "今日");
    setText(nodes.quotes, `${numberFormatter.format(event.quoteCount || 0)} 报价`);
    setText(nodes.updated, formatClock(event.lastCapturedAt));
  }

  function createLeagueGroup(group) {
    const groupKey = `${group.scope}:${group.league}`;
    const collapsed = state.collapsedLeagues.has(groupKey);
    const liveCount = group.events.filter((event) => event.scope === "live").length;
    const section = el(
      "section",
      `league-group${liveCount ? " has-live" : ""}${collapsed ? " collapsed" : ""}`
    );
    section.dataset.league = group.league;

    const header = el("button", "league-header");
    header.type = "button";
    header.title = group.league;
    header.setAttribute("aria-expanded", String(!collapsed));

    const chevron = el("span", "league-chevron", "⌄");
    const identity = el("span", "league-identity");
    identity.append(el("span", "league-name", group.league));

    const stats = el("span", "league-stats");
    if (liveCount) {
      const liveBadge = el("span", "league-live", `滚球 ${liveCount}`);
      liveBadge.prepend(el("i", "league-live-dot"));
      stats.append(liveBadge);
    }
    stats.append(el("span", "league-event-count", `${group.events.length} 场`));
    header.append(chevron, identity, stats);

    const eventBox = el("div", "league-events");
    eventBox.hidden = collapsed;
    for (const event of group.events) eventBox.append(createEventItem(event));

    header.addEventListener("click", () => {
      const nextCollapsed = !state.collapsedLeagues.has(groupKey);
      if (nextCollapsed) {
        state.collapsedLeagues.add(groupKey);
      } else {
        state.collapsedLeagues.delete(groupKey);
      }
      section.classList.toggle("collapsed", nextCollapsed);
      header.setAttribute("aria-expanded", String(!nextCollapsed));
      eventBox.hidden = nextCollapsed;
    });
    section.append(header, eventBox);
    return section;
  }

  function createScopeSection(scope, groups) {
    const collapsed = state.collapsedScopes[scope];
    const eventCount = groups.reduce((total, group) => total + group.events.length, 0);
    const isLive = scope === "live";
    const section = el(
      "section",
      `scope-section scope-${scope}${collapsed ? " collapsed" : ""}`
    );
    section.dataset.scope = scope;

    const header = el("button", "scope-header");
    header.type = "button";
    header.setAttribute("aria-expanded", String(!collapsed));

    const identity = el("span", "scope-identity");
    const kicker = el("span", "scope-kicker", isLive ? "LIVE NOW" : "TODAY");
    const title = el("span", "scope-title", isLive ? "滚球中" : "今日待开");
    identity.append(kicker, title);

    const meta = el("span", "scope-meta");
    meta.append(
      el("span", `scope-count ${scope}`, `${numberFormatter.format(eventCount)} 场`),
      el("span", "scope-leagues", `${numberFormatter.format(groups.length)} 联赛`)
    );
    const chevron = el("span", "scope-chevron", "⌄");
    header.append(identity, meta, chevron);

    const body = el("div", "scope-events");
    body.hidden = collapsed;
    for (const group of groups) body.append(createLeagueGroup(group));

    header.addEventListener("click", () => {
      const nextCollapsed = !state.collapsedScopes[scope];
      state.collapsedScopes[scope] = nextCollapsed;
      section.classList.toggle("collapsed", nextCollapsed);
      header.setAttribute("aria-expanded", String(!nextCollapsed));
      body.hidden = nextCollapsed;
    });

    section.append(header, body);
    return section;
  }

  function renderEvents(force = false) {
    const events = sortedEvents(state.events);
    const groups = groupEventsByLeague(events);
    const signature = [
      state.filter,
      state.search,
      state.sort,
      events.map((event) => [
        event.id,
        event.name,
        event.league,
        event.kickoff,
        event.scope,
        event.metadataStatus,
      ].join(":")).join("|"),
    ].join("::");
    const rebuild = force || signature !== state.eventsSignature;
    const previousScrollTop = dom.eventList.scrollTop;
    dom.eventCount.textContent = `${numberFormatter.format(events.length)} 场 / ${numberFormatter.format(groups.length)} 联赛`;

    if (rebuild) {
      state.eventsSignature = signature;
      state.eventNodes.clear();
      dom.eventList.replaceChildren();
      if (!events.length) {
        const empty = el("div", "empty-state");
        empty.style.minHeight = "180px";
        empty.append(
          el("strong", "", "没有匹配的赛事"),
          el("p", "", "尝试清空搜索条件或切换元数据筛选。")
        );
        dom.eventList.append(empty);
        return;
      }
      const fragment = document.createDocumentFragment();
      const liveGroups = groups.filter((group) => group.scope === "live");
      const todayGroups = groups.filter((group) => group.scope === "today");
      if (liveGroups.length) fragment.append(createScopeSection("live", liveGroups));
      if (todayGroups.length) fragment.append(createScopeSection("today", todayGroups));
      dom.eventList.append(fragment);
      dom.eventList.scrollTop = previousScrollTop;
      return;
    }

    for (const event of state.events) {
      const button = state.eventNodes.get(event.id);
      if (button) updateEventItem(button, event);
    }
    dom.eventList.scrollTop = previousScrollTop;
  }

  function renderSelected() {
    const event = state.selectedEvent;
    if (!event) {
      dom.selectedName.textContent = "请选择一场赛事";
      dom.selectedLeague.textContent = "联赛 --";
      dom.selectedScore.hidden = true;
      dom.selectedClock.hidden = true;
      dom.selectedKickoff.textContent = "开赛 --";
      dom.selectedQuality.textContent = "状态 --";
      dom.selectedQuality.className = "meta-pill";
      dom.selectedQuotes.textContent = "--";
      dom.selectedChanged.textContent = "--";
      dom.selectedChanged.title = "";
      return;
    }
    const scoreHome = event.scoreHome === null || event.scoreHome === undefined ? "" : String(event.scoreHome);
    const scoreAway = event.scoreAway === null || event.scoreAway === undefined ? "" : String(event.scoreAway);
    const hasScore = Boolean(event.isLive && (scoreHome || scoreAway));
    const clock = matchClockLabel(event);
    const quoteCount = Number(event.quoteCount) || 0;
    const rowCount = Number(event.rowCount) || 0;
    const updatedAt = event.lastCapturedAt || event.lastChangedAt || "";
    const age = quoteAgeInfo(updatedAt);

    dom.selectedName.textContent = event.name || `赛事 ${event.id}`;
    dom.selectedLeague.textContent = leagueDisplayName(event.league) || "联赛未知";
    dom.selectedScore.hidden = !hasScore;
    dom.selectedScore.textContent = hasScore ? `比分 ${scoreHome || "0"}–${scoreAway || "0"}` : "比分 --";
    dom.selectedScore.classList.toggle("live", hasScore);
    dom.selectedClock.hidden = !clock;
    dom.selectedClock.textContent = clock || "比赛 --";
    dom.selectedClock.classList.toggle("live", Boolean(clock));
    dom.selectedKickoff.textContent = `开赛 ${formatKickoff(event.kickoff)}`;
    dom.selectedQuality.textContent = qualityLabel(event.metadataStatus);
    dom.selectedQuality.className = `meta-pill ${event.metadataStatus || "missing"}`;
    dom.selectedQuotes.textContent = `${numberFormatter.format(quoteCount)} / ${numberFormatter.format(rowCount)}`;
    dom.selectedQuotes.title = `有效报价 ${quoteCount}，盘口行 ${rowCount}`;
    dom.selectedChanged.textContent = updatedAt ? age.text : "暂无数据";
    dom.selectedChanged.className = age.level === "aged" ? "aged" : "";
    dom.selectedChanged.title = updatedAt ? formatShortDate(updatedAt) : "";
  }

  function createSparkline(history) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "sparkline");
    svg.setAttribute("viewBox", "0 0 100 27");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    const values = (history || [])
      .map(historyHongKong)
      .filter((value) => value !== null);
    if (!values.length) return svg;
    const first = values[0];
    const last = values[values.length - 1];
    const direction = last > first ? "up" : last < first ? "down" : "flat";
    svg.setAttribute("aria-label", `香港赔率走势，从 ${first.toFixed(3)} 到 ${last.toFixed(3)}`);

    const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
    base.setAttribute("class", "baseline");
    base.setAttribute("x1", "0");
    base.setAttribute("x2", "100");
    base.setAttribute("y1", "24.5");
    base.setAttribute("y2", "24.5");
    svg.append(base);

    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 0.0001) {
      min -= 0.01;
      max += 0.01;
    }
    const points = values.map((value, index) => {
      const x = values.length === 1 ? 50 : 2 + (index / (values.length - 1)) * 96;
      const y = 22 - ((value - min) / (max - min)) * 19;
      return [x, y];
    });
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `line ${direction}`);
    path.setAttribute(
      "d",
      points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ")
    );
    svg.append(path);
    return svg;
  }

  function createDelta(row) {
    if (row && !row.quoted) {
      return el("span", "delta-pill suspended", "暂停");
    }
    const direction = row?.direction || "flat";
    const pill = el("span", `delta-pill ${direction}`);
    if (direction === "new") {
      pill.textContent = "新盘";
    } else if (direction === "up" || direction === "down") {
      pill.textContent = `${iconArrow(direction)} ${formatDelta(row.delta)}`;
    } else {
      pill.textContent = "—";
    }
    return pill;
  }

  function createQuoteCard(row, label = "", detail = "", compact = false) {
    const card = el("article", `quote-card${compact ? " compact" : ""}`);
    card.setAttribute("role", "cell");
    if (!row) {
      card.classList.add("missing");
      if (!compact) {
        const heading = el("div", "quote-card-heading");
        heading.append(
          el("span", "quote-label", label || "投注项"),
          el("span", "quote-detail", detail || "")
        );
        card.append(heading);
      }
      const prices = el("div", "quote-price-row");
      prices.append(
        el("strong", "quote-price", "—"),
        el("span", "quote-detail", "未报价")
      );
      card.append(prices);
      return card;
    }

    const currentPrice = row.quoted ? rowHongKong(row) : null;
    const previous = state.rowPrices.get(`${row.eventId}::${row.key}`);
    if (previous !== undefined && currentPrice !== null) {
      if (currentPrice > previous) card.classList.add("flash-up");
      if (currentPrice < previous) card.classList.add("flash-down");
    }
    state.rowPrices.set(`${row.eventId}::${row.key}`, currentPrice);

    if (!row.quoted) card.classList.add("suspended");
    const age = quoteAgeInfo(row.capturedAt);
    const tooltip = [
      label,
      detail,
      currentPrice === null ? "无有效香港赔率" : `香港赔率 ${formatPrice(currentPrice, 3)}`,
      `更新 ${formatShortDate(row.capturedAt)}`,
    ].filter(Boolean).join(" · ");
    card.title = tooltip;

    if (!compact) {
      const heading = el("div", "quote-card-heading");
      heading.append(
        el("span", "quote-label", label || "投注项"),
        el("span", "quote-detail", detail || "")
      );
      card.append(heading);
    }

    const prices = el("div", "quote-price-row");
    const price = el("strong", "quote-price", formatPrice(currentPrice, 3));
    prices.append(price, createDelta(row));

    const metrics = el("div", "quote-metrics");
    const updated = el("span", `quote-age ${age.level}`, age.text);
    updated.title = row.capturedAt ? formatShortDate(row.capturedAt) : "";
    metrics.append(updated);

    card.append(prices, metrics);
    return card;
  }

  function createMarketHeader(title, detail, rows) {
    const head = el("header", "market-block-head");
    const copy = el("div", "market-block-copy");
    copy.append(
      el("h3", "market-block-title", title),
      el("p", "market-block-detail", detail)
    );

    const status = el("div", "market-block-status");
    const validCount = rows.filter((row) => row.quoted && rowHongKong(row) !== null).length;
    status.append(el("span", "market-status-badge", `${validCount}/${rows.length} 有效`));

    head.append(copy, status);
    return head;
  }

  function renderThreeWayMarket(rows) {
    const section = el("section", "market-block");
    section.setAttribute("aria-label", "胜平负盘口");
    section.append(createMarketHeader("胜平负", "1X2 · 全场 · 香港赔率", rows));

    const [home, away] = teamNames(state.selectedEvent?.name);
    const definitions = [
      { option: "0", label: "主胜", detail: home },
      { option: "1", label: "和局", detail: "双方打平" },
      { option: "2", label: "客胜", detail: away },
    ];
    const grid = el("div", "quote-grid three-way");
    grid.setAttribute("role", "row");
    for (const definition of definitions) {
      const row = rows.find((item) => String(item.option) === definition.option) || null;
      grid.append(createQuoteCard(row, definition.label, definition.detail, false));
    }
    section.append(grid);
    return section;
  }

  function createLineHeader(lineLabel, sideLabels) {
    const head = el("div", "market-line-head");
    head.setAttribute("role", "row");
    const lineHead = el("span", "", lineLabel);
    lineHead.setAttribute("role", "columnheader");
    head.append(lineHead);
    for (const label of sideLabels) {
      const node = el("span", "", label);
      node.setAttribute("role", "columnheader");
      head.append(node);
    }
    return head;
  }

  function buildLineGroups(rows, keyForRow, lineForRow) {
    const groups = new Map();
    for (const row of rows) {
      const line = lineForRow(row);
      if (line === null || !Number.isFinite(line)) continue;
      const key = keyForRow(row, line);
      if (!groups.has(key)) groups.set(key, { line, rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()].sort((left, right) => left.line - right.line);
  }

  function renderHandicapMarket(rows) {
    const [home, away] = teamNames(state.selectedEvent?.name);
    const section = el("section", "market-block");
    section.setAttribute("aria-label", "亚洲让球盘口");
    section.append(createMarketHeader("亚洲让球", "全场 · 主队盘口视角 · 让球/受让 · 香港赔率", rows));

    const groups = buildLineGroups(
      rows,
      (row, line) => line.toFixed(4),
      handicapSideLine
    );
    const table = el("div", "market-line-table");
    table.setAttribute("role", "table");
    table.append(createLineHeader("主队盘口", [home, away]));

    for (const group of groups) {
      const lineRow = el("div", "market-line-row");
      lineRow.setAttribute("role", "row");
      const lineCell = el("div", "line-label");
      lineCell.setAttribute("role", "rowheader");
      const lineRole = Math.abs(group.line) < 0.000001
        ? "平手"
        : group.line < 0
          ? "主队让球"
          : "主队受让";
      lineCell.append(
        el("strong", "", formatHandicapLine(group.line)),
        el("span", "", lineRole)
      );

      const homeRow = group.rows.find((row) => String(row.option) === "0") || null;
      const awayRow = group.rows.find((row) => String(row.option) === "1") || null;
      lineRow.append(
        lineCell,
        createQuoteCard(homeRow, home, "", true),
        createQuoteCard(awayRow, away, "", true)
      );
      table.append(lineRow);
    }
    section.append(table);
    return section;
  }

  function renderTotalsMarket(rows) {
    const section = el("section", "market-block");
    section.setAttribute("aria-label", "大小球盘口");
    section.append(createMarketHeader("进球数大小", "全场 · 总进球 · 大小球 · 香港赔率", rows));

    const groups = buildLineGroups(
      rows,
      (row, line) => line.toFixed(4),
      (row) => {
        const line = Number(row.line);
        return Number.isFinite(line) ? line : null;
      }
    );
    const table = el("div", "market-line-table");
    table.setAttribute("role", "table");
    table.append(createLineHeader("总进球线", ["大", "小"]));

    for (const group of groups) {
      const lineRow = el("div", "market-line-row");
      lineRow.setAttribute("role", "row");
      const lineCell = el("div", "line-label");
      lineCell.setAttribute("role", "rowheader");
      lineCell.append(
        el("strong", "", formatTotalLine(group.line)),
        el("span", "", "总进球")
      );

      const overRow = group.rows.find((row) => String(row.option) === "3") || null;
      const underRow = group.rows.find((row) => String(row.option) === "4") || null;
      lineRow.append(
        lineCell,
        createQuoteCard(overRow, "大", "", true),
        createQuoteCard(underRow, "小", "", true)
      );
      table.append(lineRow);
    }
    section.append(table);
    return section;
  }

  function renderMarketOverview(rows) {
    const validRows = rows.filter((row) => row.quoted && rowHongKong(row) !== null);
    const freshRows = validRows.filter((row) => {
      const age = quoteAgeInfo(row.capturedAt);
      return age.seconds !== null && age.seconds <= 60;
    });
    const latestRow = rows.reduce((latest, row) => {
      const current = parseDate(row.capturedAt);
      if (!current) return latest;
      if (!latest || current > latest) return current;
      return latest;
    }, null);
    const latestAge = latestRow ? quoteAgeInfo(latestRow.toISOString()) : { text: "—", level: "unknown" };

    dom.marketGroups.textContent = numberFormatter.format(countMarketGroups(rows));
    dom.marketQuotes.textContent = `${numberFormatter.format(validRows.length)} / ${numberFormatter.format(rows.length)}`;
    dom.marketFresh.textContent = `${numberFormatter.format(freshRows.length)} / ${numberFormatter.format(validRows.length)}`;
    dom.marketLastUpdate.textContent = latestAge.text;
    dom.marketLastUpdate.className = latestAge.level === "aged" ? "aged" : latestAge.level;
  }

  function renderOdds() {
    const rows = state.market === "all"
      ? state.odds
      : state.odds.filter((row) => String(row.market) === state.market);
    renderMarketOverview(rows);
    dom.oddsBoard.replaceChildren();

    if (!rows.length) {
      dom.oddsEmpty.classList.remove("hidden");
      dom.oddsBoard.classList.add("hidden");
      return;
    }

    dom.oddsEmpty.classList.add("hidden");
    dom.oddsBoard.classList.remove("hidden");
    const fragment = document.createDocumentFragment();
    if (rows.some((row) => String(row.market) === "1")) {
      fragment.append(renderThreeWayMarket(rows.filter((row) => String(row.market) === "1")));
    }
    if (rows.some((row) => String(row.market) === "2")) {
      fragment.append(renderHandicapMarket(rows.filter((row) => String(row.market) === "2")));
    }
    if (rows.some((row) => String(row.market) === "3")) {
      fragment.append(renderTotalsMarket(rows.filter((row) => String(row.market) === "3")));
    }
    dom.oddsBoard.append(fragment);
  }

  function renderChanges(force = false) {
    const signature = state.changes
      .slice(0, 8)
      .map((change) => change.serial)
      .join("|");
    if (!force && signature === state.changesSignature) return;
    state.changesSignature = signature;
    dom.changeCount.textContent = numberFormatter.format(state.changes.length);
    dom.changeFeed.replaceChildren();
    if (!state.changes.length) {
      dom.changeFeed.append(el("div", "change-empty", "等待新的赔率变化…"));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const change of state.changes.slice(0, 8)) {
      const card = el("button", "change-card");
      card.type = "button";
      card.dataset.eventId = change.eventId;
      const selection = selectionLabel(change, change.eventName);
      card.title = `${change.eventName} · ${marketLabel(change.market)} · ${stageLabel(change.stage)} · ${selection.primary}`;
      const top = el("div", "change-card-top");
      top.append(
        el("span", "change-card-event", change.eventName || `赛事 ${change.eventId}`),
        el("span", `change-direction ${change.direction}`, iconArrow(change.direction))
      );
      const value = el("div", "change-card-value");
      value.append(
        el("span", "old", formatPrice(decimalToHongKong(change.old))),
        el("span", "arrow", "→"),
        el("span", `new ${change.direction}`, formatPrice(decimalToHongKong(change.new)))
      );
      const bottom = el("div", "change-card-bottom");
      bottom.append(
        el(
          "span",
          "change-card-market",
          `${marketLabel(change.market)} · ${stageLabel(change.stage)} · ${selection.primary}`
        ),
        el("span", "", formatClock(change.capturedAt))
      );
      card.append(top, value, bottom);
      fragment.append(card);
    }
    dom.changeFeed.append(fragment);
  }

  function applySnapshot(snapshot) {
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
  }

  async function refresh(force = false) {
    if ((state.paused && !force) || state.refreshing) return;
    state.refreshing = true;
    dom.refreshButton.disabled = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const query = state.eventId
        ? `?event_id=${encodeURIComponent(state.eventId)}`
        : "";
      const response = await fetch(`/api/snapshot${query}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json();
      applySnapshot(snapshot);
    } catch (error) {
      state.failures += 1;
      if (state.failures >= 2) {
        setStatus("offline", state.paused);
      }
      if (force) showToast(`刷新失败：${error.message || "无法连接看板服务"}`);
    } finally {
      window.clearTimeout(timer);
      dom.refreshButton.disabled = false;
      state.refreshing = false;
    }
  }

  function selectEvent(eventId) {
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

  setupSectionCollapse(
    dom.historyPanel,
    dom.historyToggle,
    dom.historyContent,
    "ps3838.dashboard.historyCollapsed",
  );
  setupSectionCollapse(
    dom.changesPanel,
    dom.changesToggle,
    dom.changesContent,
    "ps3838.dashboard.changesCollapsed",
  );

  dom.eventList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-event-id]");
    if (item) selectEvent(item.dataset.eventId);
  });

  dom.changeFeed.addEventListener("click", (event) => {
    const card = event.target.closest("[data-event-id]");
    if (card) selectEvent(card.dataset.eventId);
  });

  dom.eventSearch.addEventListener("input", () => {
    state.search = dom.eventSearch.value.trim().toLowerCase();
    renderEvents(true);
  });

  dom.metadataFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    for (const chip of dom.metadataFilters.querySelectorAll("[data-filter]")) {
      chip.classList.toggle("active", chip === button);
    }
    renderEvents(true);
  });

  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    renderEvents(true);
  });

  dom.historyRowSelect.addEventListener("change", () => {
    state.historyRowKey = dom.historyRowSelect.value;
    state.historyPoints = [];
    state.historySummary = null;
    state.historyLastFetch = 0;
    clearHistoryChart();
    fetchHistory(true);
  });

  dom.historyRangeSelect.addEventListener("change", () => {
    state.historyHours = Number(dom.historyRangeSelect.value) || 24;
    state.historyPoints = [];
    state.historySummary = null;
    state.historyLastFetch = 0;
    clearHistoryChart();
    fetchHistory(true);
  });

  dom.historyRefreshButton.addEventListener("click", () => {
    fetchHistory(true);
  });

  dom.primaryNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button) showPage(button.dataset.page);
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-page-link]");
    if (link) showPage(link.dataset.pageLink);
  });

  window.addEventListener("hashchange", () => {
    showPage(resolvePage(location.hash.slice(1)), false);
  });

  dom.marketTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-market]");
    if (!button) return;
    state.market = button.dataset.market;
    for (const tab of dom.marketTabs.querySelectorAll("[data-market]")) {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    renderOdds();
  });

  dom.pauseButton.addEventListener("click", () => {
    if (state.currentPage === "crown") {
      state.crownPaused = !state.crownPaused;
      postCrownCommand("set-paused", { paused: state.crownPaused });
      updateRefreshControls();
      showToast(state.crownPaused ? "已暂停皇冠自动刷新" : "已恢复皇冠自动刷新");
      return;
    }
    state.paused = !state.paused;
    updateRefreshControls();
    setStatus(state.snapshot?.freshness || "no-data", state.paused);
    if (!state.paused) refresh(true);
    showToast(state.paused ? "已暂停自动刷新" : "已恢复自动刷新");
  });

  dom.refreshButton.addEventListener("click", () => {
    if (state.currentPage === "crown") {
      postCrownCommand("refresh");
      showToast("正在刷新皇冠数据");
      return;
    }
    refresh(true);
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== dom.crownFrame?.contentWindow) return;
    const data = event.data || {};
    if (data.type !== "crown:state") return;
    state.crownPaused = Boolean(data.paused);
    if (state.currentPage === "crown") updateRefreshControls();
  });

  dom.crownFrame?.addEventListener("load", () => {
    postCrownCommand("set-paused", { paused: state.crownPaused });
  });

  dom.metadataCheckButton.addEventListener("click", () => {
    startMetadataSync(false);
  });

  dom.metadataRepairButton.addEventListener("click", () => {
    startMetadataSync(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (!state.paused) refresh();
      fetchMetadataStatus();
    }
  });

  showPage(resolvePage(location.hash.slice(1)), false);
  refresh(true);
  fetchMetadataStatus();
  window.setInterval(() => {
    if (!document.hidden) {
      refresh();
      fetchMetadataStatus();
    }
  }, POLL_INTERVAL);
})();
