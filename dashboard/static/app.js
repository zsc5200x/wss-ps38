(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const numberFormatter = new Intl.NumberFormat("zh-CN");
  const POLL_INTERVAL = 1400;

  const dom = {
    primaryNav: $("primaryNav"),
    pagePanels: [...document.querySelectorAll("[data-page-panel]")],
    crownFrames: [...document.querySelectorAll("[data-crown-frame]")],
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
    mergeRefreshButton: $("mergeRefreshButton"),
    mergePinnacleCount: $("mergePinnacleCount"),
    mergeCrownCount: $("mergeCrownCount"),
    mergeSourceButtons: document.querySelectorAll("[data-merge-source]"),
    mergeMappedCount: $("mergeMappedCount"),
    mergePendingCount: $("mergePendingCount"),
    mergeSearch: $("mergeSearch"),
    mergeFilters: document.querySelector(".merge-filters"),
    mergeError: $("mergeError"),
    mergeLoading: $("mergeLoading"),
    mergeEmpty: $("mergeEmpty"),
    mergeCrownOptions: $("mergeCrownOptions"),
    mergePinnacleOptions: $("mergePinnacleOptions"),
    mergeGroups: $("mergeGroups"),
    mergePinnacleLeagueOptions: $("mergePinnacleLeagueOptions"),
    settingsPage: $("settingsPage"),
    settingsSaveStatus: $("settingsSaveStatus"),
    settingsRefreshButton: $("settingsRefreshButton"),
    settingsSaveButton: $("settingsSaveButton"),
    settingsRestartNotice: $("settingsRestartNotice"),
    settingsStatusUpdated: $("settingsStatusUpdated"),
    settingsDashboardState: $("settingsDashboardState"),
    settingsDashboardDetail: $("settingsDashboardDetail"),
    settingsDataState: $("settingsDataState"),
    settingsDataDetail: $("settingsDataDetail"),
    settingsDatabaseState: $("settingsDatabaseState"),
    settingsDatabaseDetail: $("settingsDatabaseDetail"),
    settingsMetadataState: $("settingsMetadataState"),
    settingsMetadataDetail: $("settingsMetadataDetail"),
    settingsDefaultPage: $("settingsDefaultPage"),
    settingsDefaultSort: $("settingsDefaultSort"),
    settingsDefaultFilter: $("settingsDefaultFilter"),
    settingsDefaultHistory: $("settingsDefaultHistory"),
    settingsChangeLimit: $("settingsChangeLimit"),
    settingsPresenceInterval: $("settingsPresenceInterval"),
    settingsSnapshotInterval: $("settingsSnapshotInterval"),
    settingsRotationMb: $("settingsRotationMb"),
    settingsCompressAfter: $("settingsCompressAfter"),
    settingsCompressMin: $("settingsCompressMin"),
    settingsBackupKeep: $("settingsBackupKeep"),
    settingsCapturePath: $("settingsCapturePath"),
    settingsDatabasePath: $("settingsDatabasePath"),
    settingsBackupPath: $("settingsBackupPath"),
    settingsMaintenanceSummary: $("settingsMaintenanceSummary"),
    settingsMaintenanceDetail: $("settingsMaintenanceDetail"),
    settingsMetadataCheckButton: $("settingsMetadataCheckButton"),
    settingsMetadataRepairButton: $("settingsMetadataRepairButton"),
    settingsBackupButton: $("settingsBackupButton"),
    settingsIntegrityButton: $("settingsIntegrityButton"),
    settingsMaintenanceResult: $("settingsMaintenanceResult"),
    settingsCdpUrl: $("settingsCdpUrl"),
    settingsTargetHosts: $("settingsTargetHosts"),
    settingsChromeProfile: $("settingsChromeProfile"),
    settingsStartUrl: $("settingsStartUrl"),
  };

  const state = {
    eventId: "",
    events: [],
    selectedEvent: null,
    odds: [],
    changes: [],
    changeLimit: 8,
    filter: "all",
    search: "",
    sort: "stable",
    collapsedLeagues: new Set(),
    collapsedScopes: { live: false, today: false },
    market: "all",
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
    settings: {
      config: {},
      defaults: {},
      restartRequired: [],
      loading: false,
      saving: false,
      initialized: false,
    },
    merge: {
      data: null,
      loading: false,
      error: "",
      source: "crown",
      filter: "all",
      search: "",
      openLeagueBySource: { crown: "", pinnacle: "" },
      editingLeagueIds: new Set(),
      lastFetchAt: 0,
      requestSerial: 0,
      selectedCrownByPinnacle: new Map(),
      selectedPinnacleByCrown: new Map(),
      selectedPinnacleLeagueByCrown: new Map(),
      leagueSavingCrownIds: new Set(),
      leagueOptionByValue: new Map(),
      leagueOptionsData: null,
      editingPinnacleIds: new Set(),
      optionByValue: new Map(),
      optionsData: null,
      pinnacleOptionByValue: new Map(),
      pinnacleOptionsData: null,
      savingPinnacleIds: new Set(),
    },
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

  const SETTINGS_PREF_KEYS = {
    page: "ps3838.dashboard.defaultPage",
    sort: "ps3838.dashboard.defaultSort",
    filter: "ps3838.dashboard.defaultFilter",
    history: "ps3838.dashboard.defaultHistory",
    changeLimit: "ps3838.dashboard.changeLimit",
  };

  function readPreference(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  function writePreference(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (_error) {
      // A restricted storage policy should not prevent the dashboard from working.
    }
  }

  function loadSettingsPreferences() {
    const page = resolvePage(readPreference(SETTINGS_PREF_KEYS.page, "home"));
    state.sort = ["stable", "kickoff", "name"].includes(
      readPreference(SETTINGS_PREF_KEYS.sort, "stable")
    ) ? readPreference(SETTINGS_PREF_KEYS.sort, "stable") : "stable";
    state.filter = ["all", "complete", "partial", "missing"].includes(
      readPreference(SETTINGS_PREF_KEYS.filter, "all")
    ) ? readPreference(SETTINGS_PREF_KEYS.filter, "all") : "all";
    state.historyHours = [1, 6, 24, 168, 720].includes(
      Number(readPreference(SETTINGS_PREF_KEYS.history, "24"))
    ) ? Number(readPreference(SETTINGS_PREF_KEYS.history, "24")) : 24;
    const requestedLimit = Number(readPreference(SETTINGS_PREF_KEYS.changeLimit, "8"));
    state.changeLimit = [8, 12, 24].includes(requestedLimit) ? requestedLimit : 8;
    return page;
  }

  function syncPreferenceControls() {
    if (dom.sortSelect) dom.sortSelect.value = state.sort;
    if (dom.historyRangeSelect) dom.historyRangeSelect.value = String(state.historyHours);
    if (dom.settingsDefaultPage) dom.settingsDefaultPage.value = resolvePage(readPreference(SETTINGS_PREF_KEYS.page, "home"));
    if (dom.settingsDefaultSort) dom.settingsDefaultSort.value = state.sort;
    if (dom.settingsDefaultFilter) dom.settingsDefaultFilter.value = state.filter;
    if (dom.settingsDefaultHistory) dom.settingsDefaultHistory.value = String(state.historyHours);
    if (dom.settingsChangeLimit) dom.settingsChangeLimit.value = String(state.changeLimit);
    for (const chip of dom.metadataFilters?.querySelectorAll("[data-filter]") || []) {
      chip.classList.toggle("active", chip.dataset.filter === state.filter);
    }
  }

  function saveSettingsPreferences() {
    writePreference(SETTINGS_PREF_KEYS.page, dom.settingsDefaultPage?.value || "home");
    writePreference(SETTINGS_PREF_KEYS.sort, dom.settingsDefaultSort?.value || "stable");
    writePreference(SETTINGS_PREF_KEYS.filter, dom.settingsDefaultFilter?.value || "all");
    writePreference(SETTINGS_PREF_KEYS.history, dom.settingsDefaultHistory?.value || "24");
    writePreference(SETTINGS_PREF_KEYS.changeLimit, dom.settingsChangeLimit?.value || "8");
  }

  function settingsConfigFromPayload(payload) {
    if (!payload || typeof payload !== "object") return {};
    if (payload.config && typeof payload.config === "object") return payload.config;
    if (payload.effective && typeof payload.effective === "object") return payload.effective;
    if (payload.settings && typeof payload.settings === "object") return payload.settings;
    return payload;
  }

  function formatSettingsBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "--";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function settingsValue(value, fallback = "") {
    return value === null || value === undefined || value === "" ? fallback : value;
  }

  function renderSettingsStatusFromSnapshot(snapshot = state.snapshot) {
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

  function renderSettingsPayload(payload) {
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

  async function fetchSettings(showError = false) {
    if (state.settings.loading) return;
    state.settings.loading = true;
    if (dom.settingsSaveStatus) dom.settingsSaveStatus.textContent = "读取配置中…";
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
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

  function collectSettingsForm() {
    return {
      presence_interval_seconds: Number(dom.settingsPresenceInterval?.value || 5),
      snapshot_interval_seconds: Number(dom.settingsSnapshotInterval?.value || 2),
      capture_rotation_mb: Number(dom.settingsRotationMb?.value || 0),
      capture_compress_after_hours: Number(dom.settingsCompressAfter?.value || 24),
      capture_compress_min_mb: Number(dom.settingsCompressMin?.value || 16),
      backup_keep: Number(dom.settingsBackupKeep?.value || 7),
    };
  }

  async function saveSettings() {
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
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json().catch(() => ({}));
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

  async function runSettingsMaintenance(action) {
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
        const response = await fetch(endpoint, { method: "POST" });
        const payload = await response.json().catch(() => ({}));
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

  function resolvePage(value) {
    return ["home", "pinnacle", "crown", "my-events", "merge", "settings"].includes(value) ? value : "home";
  }

  function isCrownView(page = state.currentPage) {
    return page === "home" || page === "crown";
  }

  function activeCrownFrame() {
    return dom.crownFrames.find((frame) => {
      const panel = frame.closest("[data-page-panel]");
      return panel?.dataset.pagePanel === state.currentPage;
    }) || null;
  }

  function ensureCrownFrameLoaded(frame = activeCrownFrame()) {
    if (!frame || frame.dataset.loaded === "true") return;
    const source = frame.dataset.src;
    if (!source) return;
    frame.dataset.loaded = "true";
    frame.src = source;
  }

  function postCrownCommandTo(frame, command, payload = {}) {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: "crown:command", command, ...payload },
      location.origin,
    );
  }

  function syncCrownFrameActivity() {
    const activeFrame = activeCrownFrame();
    for (const frame of dom.crownFrames) {
      if (frame.dataset.loaded !== "true") continue;
      postCrownCommandTo(frame, "set-paused", {
        paused: frame !== activeFrame,
      });
    }
  }

  function mergeTeams(event) {
    const home = String(event?.home || "").trim();
    const away = String(event?.away || "").trim();
    if (home || away) return [home, away];
    const name = String(event?.name || "");
    const parts = name.split(/\s+(?:VS\.?|V)\s+/i);
    return parts.length > 1 ? [parts[0].trim(), parts.slice(1).join(" vs ").trim()] : [name.trim(), ""];
  }

  function mergeFixtureLabel(event) {
    const [home, away] = mergeTeams(event);
    return [home, away].filter(Boolean).join(" vs ") || "赛事名称待补全";
  }

  function mergeEventTime(event, source) {
    const normalized = String(event?.normalizedKickoff || "").trim();
    if (normalized) return normalized;
    const raw = source === "crown" ? event?.startLabel : event?.kickoff;
    return String(raw || "时间未知");
  }

  function mergeEventRawTime(event, source) {
    const raw = source === "crown" ? event?.startLabel : event?.kickoff;
    return String(raw || "").trim();
  }

  function mergeCrownOptionValue(event) {
    const id = String(event?.id || "");
    const leagueId = String(event?.leagueId || "");
    const league = String(event?.league || "未命名联赛");
    const kickoff = mergeEventTime(event, "crown");
    return `${mergeFixtureLabel(event)} · ${league} · ${kickoff} · 赛事 ${id} · 联赛 ${leagueId || "--"}`;
  }

  function mergePinnacleOptionValue(event) {
    const id = String(event?.id || "");
    const leagueId = String(event?.leagueId || "");
    const league = String(event?.league || "未命名联赛");
    const kickoff = mergeEventTime(event, "pinnacle");
    return `${mergeFixtureLabel(event)} · ${league} · ${kickoff} · 赛事 ${id} · 联赛 ${leagueId || "--"}`;
  }

  function mergeMappedByPinnacle(data) {
    return new Map((data?.mappings || []).map((item) => [String(item.pinnacleId), item]));
  }

  function mergeCrownById(data) {
    return new Map((data?.crownEvents || []).map((item) => [String(item.id), item]));
  }

  function mergeSourceBlock(source, event) {
    const [home, away] = mergeTeams(event);
    const isPinnacle = source === "pinnacle";
    const idLabel = isPinnacle ? "赛事 ID" : "赛事 ID";
    const leagueId = String(event?.leagueId || "--");
    const eventId = String(event?.id || "--");
    const sourceKind = isPinnacle ? "pinnacle" : "crown";
    const time = mergeEventTime(event, sourceKind);
    const rawTime = mergeEventRawTime(event, sourceKind);
    const block = el("div", `merge-source merge-source-${source}`);
    const top = el("div", "merge-source-top");
    top.append(el("span", "merge-source-label", isPinnacle ? "平博" : "皇冠"));
    top.append(el("span", "merge-source-league", String(event?.league || "未命名联赛")));
    block.append(top);
    block.append(el("strong", "merge-source-teams", [home, away].filter(Boolean).join(" vs ") || "赛事名称待补全"));
    const details = el("div", "merge-source-details");
    details.append(el("span", "merge-source-time", time));
    if (rawTime && rawTime !== time) {
      details.append(el("span", "merge-id-pair", `原始时间 ${rawTime}`));
    }
    details.append(el("span", "merge-id-pair", `${idLabel} ${eventId}`));
    details.append(el("span", "merge-id-pair", `联赛 ID ${leagueId}`));
    if (!isPinnacle && event?.score) details.append(el("span", "merge-id-pair", `比分 ${event.score}`));
    if (!isPinnacle && event?.minute) details.append(el("span", "merge-id-pair", String(event.minute)));
    block.append(details);
    return block;
  }

  function mergeSuggestionReasons(suggestion) {
    const reasons = Array.isArray(suggestion?.reasons) ? suggestion.reasons.filter(Boolean) : [];
    if (reasons.length) return reasons.join(" · ");
    const confidence = String(suggestion?.confidence || "");
    return confidence === "high" ? "队名与赛事信息较接近" : "候选需人工核对";
  }

  function mergeRow(pinnacle, mappings, crownById, suggestions, availableCrownIds, optionsListId = "mergeCrownOptions") {
    const pinnacleId = String(pinnacle.id);
    const mapping = mappings.get(pinnacleId);
    const mappedCrown = mapping
      ? (crownById.get(String(mapping.crownId)) || mapping.crownSnapshot || null)
      : null;
    const editing = state.merge.editingPinnacleIds.has(pinnacleId);
    const selectedCrownId = state.merge.selectedCrownByPinnacle.get(pinnacleId) || "";
    const row = el("article", `merge-row${mapping ? " is-mapped" : " is-pending"}`);
    row.dataset.pinnacleId = pinnacleId;
    row.append(mergeSourceBlock("pinnacle", pinnacle));

    const target = el("div", "merge-target");
    if (mapping && mappedCrown && !editing) {
      const heading = el("div", "merge-target-heading");
      heading.append(el("span", "merge-status mapped", "已确认关联"));
      target.append(heading, mergeSourceBlock("crown", mappedCrown));
      const actions = el("div", "merge-row-actions");
      const changeButton = el("button", "merge-action-button", "更换关联");
      changeButton.type = "button";
      changeButton.dataset.mergeAction = "edit";
      changeButton.dataset.pinnacleId = pinnacleId;
      actions.append(changeButton);
      const unmapButton = el("button", "merge-action-button danger", "解除关联");
      unmapButton.type = "button";
      unmapButton.dataset.mergeAction = "unmap";
      unmapButton.dataset.pinnacleId = pinnacleId;
      unmapButton.disabled = state.merge.savingPinnacleIds.has(pinnacleId);
      actions.append(unmapButton);
      target.append(actions);
      row.append(target);
      return row;
    }

    const heading = el("div", "merge-target-heading");
    heading.append(el("span", `merge-status ${mapping ? "pending" : "pending"}`, mapping ? "正在更换关联" : "待人工确认"));
    if (mapping) {
      const cancel = el("button", "merge-text-button", "取消");
      cancel.type = "button";
      cancel.dataset.mergeAction = "cancel-edit";
      cancel.dataset.pinnacleId = pinnacleId;
      heading.append(cancel);
    }
    target.append(heading);

    const candidateBox = el("div", "merge-candidate-box");
    const label = el("label", "merge-picker-label", "选择对应的皇冠赛事");
    label.htmlFor = `merge-crown-picker-${pinnacleId}`;
    candidateBox.append(label);

    const rowSuggestions = (suggestions.get(pinnacleId) || [])
      .filter((item) => availableCrownIds.has(String(item.crownId)))
      .slice(0, 5);

    const input = el("input", "merge-picker");
    input.type = "search";
    input.id = `merge-crown-picker-${pinnacleId}`;
    input.setAttribute("list", optionsListId);
    input.setAttribute("autocomplete", "off");
    input.dataset.pinnacleId = pinnacleId;
    const initialId = selectedCrownId || (mapping ? String(mapping.crownId) : "");
    const initialEvent = crownById.get(initialId);
    if (initialEvent) input.value = mergeCrownOptionValue(initialEvent);
    const inputRow = el("div", "merge-picker-row");
    inputRow.append(input);
    const save = el("button", "button primary merge-confirm-button", mapping ? "保存关联" : "确认关联");
    save.type = "button";
    save.dataset.mergeAction = "map";
    save.dataset.pinnacleId = pinnacleId;
    save.disabled = !initialId || state.merge.savingPinnacleIds.has(pinnacleId);
    inputRow.append(save);
    candidateBox.append(inputRow);

    const helper = el("div", "merge-picker-help");
    helper.dataset.mergeHelp = pinnacleId;
    helper.textContent = "可按队名、联赛或赛事 ID 搜索皇冠赛事；核对联赛和开赛时间后再确认。";
    candidateBox.append(helper);

    if (rowSuggestions.length) {
      const suggestionList = el("div", "merge-suggestions");
      suggestionList.append(el("span", "merge-suggestions-label", "候选"));
      for (const suggestion of rowSuggestions.slice(0, 3)) {
        const event = crownById.get(String(suggestion.crownId));
        if (!event) continue;
        const optionButton = el("button", "merge-suggestion", mergeFixtureLabel(event));
        optionButton.type = "button";
        optionButton.dataset.mergeAction = "choose";
        optionButton.dataset.pinnacleId = pinnacleId;
        optionButton.dataset.crownId = String(event.id);
        optionButton.title = mergeSuggestionReasons(suggestion);
        const score = Number(suggestion.score);
        const scoreText = Number.isFinite(score) ? `评分 ${Math.round(score)}/100` : "候选";
        optionButton.append(el("small", "merge-suggestion-score", scoreText));
        suggestionList.append(optionButton);
      }
      if (suggestionList.children.length > 1) candidateBox.append(suggestionList);
    }

    target.append(candidateBox);
    row.append(target);
    return row;
  }

  function mergeCrownRow(crown, mappingsByCrown, pinnacleById, mappingsByPinnacle, suggestions, allowedPinnacleIds, optionsListId = "mergePinnacleOptions") {
    const crownId = String(crown.id);
    const mapping = mappingsByCrown.get(crownId);
    const pinnacle = mapping
      ? (pinnacleById.get(String(mapping.pinnacleId)) || mapping.pinnacleSnapshot || null)
      : null;
    const row = el("article", `merge-row merge-crown-row${mapping ? " is-mapped" : " is-pending"}`);
    row.dataset.crownId = crownId;
    row.append(mergeSourceBlock("crown", crown));

    const target = el("div", "merge-target");
    if (mapping && pinnacle) {
      const heading = el("div", "merge-target-heading");
      heading.append(el("span", "merge-status mapped", "已确认关联"));
      target.append(heading, mergeSourceBlock("pinnacle", pinnacle));
      const actions = el("div", "merge-row-actions");
      const unmapButton = el("button", "merge-action-button danger", "解除关联");
      unmapButton.type = "button";
      unmapButton.dataset.mergeAction = "unmap";
      unmapButton.dataset.pinnacleId = String(mapping.pinnacleId);
      unmapButton.disabled = state.merge.savingPinnacleIds.has(String(mapping.pinnacleId));
      actions.append(unmapButton);
      target.append(actions);
      row.append(target);
      return row;
    }

    const heading = el("div", "merge-target-heading");
    heading.append(el("span", "merge-status pending", "待人工确认"));
    target.append(heading);

    const candidateBox = el("div", "merge-candidate-box");
    const label = el("label", "merge-picker-label", "选择对应的平博赛事");
    label.htmlFor = `merge-pinnacle-picker-${crownId}`;
    candidateBox.append(label);

    const selectedPinnacleId = state.merge.selectedPinnacleByCrown.get(crownId) || "";
    const selectedPinnacle = pinnacleById.get(selectedPinnacleId);
    const input = el("input", "merge-picker merge-pinnacle-picker");
    input.type = "search";
    input.id = `merge-pinnacle-picker-${crownId}`;
    input.setAttribute("list", optionsListId);
    input.setAttribute("autocomplete", "off");
    input.dataset.crownId = crownId;
    if (selectedPinnacle) input.value = mergePinnacleOptionValue(selectedPinnacle);

    const inputRow = el("div", "merge-picker-row");
    inputRow.append(input);
    const save = el("button", "button primary merge-confirm-button", "确认关联");
    save.type = "button";
    save.dataset.mergeAction = "map-from-crown";
    save.dataset.crownId = crownId;
    const selectedMapping = selectedPinnacleId ? mappingsByPinnacle.get(selectedPinnacleId) : null;
    save.disabled = !selectedPinnacleId || (selectedMapping && String(selectedMapping.crownId) !== crownId)
      || state.merge.savingPinnacleIds.has(selectedPinnacleId);
    inputRow.append(save);
    candidateBox.append(inputRow);

    const helper = el("div", "merge-picker-help");
    helper.dataset.mergeCrownHelp = crownId;
    helper.textContent = selectedMapping && String(selectedMapping.crownId) !== crownId
      ? "这场平博赛事已关联其他皇冠赛事，请先在平博视图解除原关联。"
      : "可按队名、联赛或赛事 ID 搜索平博赛事；核对联赛和开赛时间后再确认。";
    candidateBox.append(helper);

    const rowSuggestions = (suggestions.get(crownId) || [])
      .filter((item) => allowedPinnacleIds.has(String(item.pinnacleId)))
      .filter((item) => !mappingsByPinnacle.has(String(item.pinnacleId)))
      .slice(0, 3);
    if (rowSuggestions.length) {
      const suggestionList = el("div", "merge-suggestions");
      suggestionList.append(el("span", "merge-suggestions-label", "候选平博赛事"));
      for (const suggestion of rowSuggestions) {
        const item = pinnacleById.get(String(suggestion.pinnacleId));
        if (!item) continue;
        const optionButton = el("button", "merge-suggestion", mergeFixtureLabel(item));
        optionButton.type = "button";
        optionButton.dataset.mergeAction = "choose-pinnacle";
        optionButton.dataset.crownId = crownId;
        optionButton.dataset.pinnacleId = String(item.id);
        optionButton.title = mergeSuggestionReasons(suggestion);
        const score = Number(suggestion.score);
        const scoreText = Number.isFinite(score) ? `评分 ${Math.round(score)}/100` : "候选";
        optionButton.append(el("small", "merge-suggestion-score", scoreText));
        suggestionList.append(optionButton);
      }
      if (suggestionList.children.length) candidateBox.append(suggestionList);
    }

    target.append(candidateBox);
    row.append(target);
    return row;
  }

  function mergeLeagueOptionValue(league) {
    return `${league.name} · 联赛 ID ${league.id} · ${league.eventCount} 场`;
  }

  function mergeLeaguesForSource(data, source, events) {
    const provided = Array.isArray(data?.[source === "crown" ? "crownLeagues" : "pinnacleLeagues"])
      ? data[source === "crown" ? "crownLeagues" : "pinnacleLeagues"]
      : [];
    const eventsByLeague = new Map();
    for (const event of events) {
      const id = String(event?.leagueId || "--");
      if (!eventsByLeague.has(id)) eventsByLeague.set(id, []);
      eventsByLeague.get(id).push(event);
    }
    if (provided.length) {
      return provided.map((league) => {
        const id = String(league?.id || "--");
        const groupedEvents = eventsByLeague.get(id) || [];
        return {
          id,
          name: String(league?.name || groupedEvents[0]?.league || "未命名联赛"),
          eventCount: Number(league?.eventCount ?? groupedEvents.length),
          events: groupedEvents,
        };
      }).filter((league) => league.events.length > 0);
    }
    return [...eventsByLeague.entries()].map(([id, groupedEvents]) => ({
      id,
      name: String(groupedEvents[0]?.league || "未命名联赛"),
      eventCount: groupedEvents.length,
      events: groupedEvents,
    }));
  }

  function renderLeagueBinding(league, source, mapping, pairedLeague, suggestions) {
    const section = el("div", `merge-league-binding${mapping ? " is-mapped" : " is-pending"}`);
    const leagueId = String(league.id);
    const crownLeagueId = source === "crown" ? leagueId : String(mapping?.crownId || "");
    const editing = source === "crown" && state.merge.editingLeagueIds.has(leagueId);
    const saving = source === "crown" && state.merge.leagueSavingCrownIds.has(leagueId);

    if (mapping && pairedLeague && !editing) {
      const summary = el("div", "merge-league-binding-summary");
      summary.append(el("span", "merge-status mapped", "联赛已绑定"));
      summary.append(el("strong", "merge-league-pair-name", `${pairedLeague.name} · ${source === "crown" ? "平博" : "皇冠"}联赛 ID ${pairedLeague.id}`));
      if (source === "crown") {
        const actions = el("div", "merge-league-actions");
        const change = el("button", "merge-action-button", "更换联赛");
        change.type = "button";
        change.dataset.mergeAction = "edit-league";
        change.dataset.crownLeagueId = leagueId;
        actions.append(change);
        const unmap = el("button", "merge-action-button danger", "解除联赛绑定");
        unmap.type = "button";
        unmap.dataset.mergeAction = "unmap-league";
        unmap.dataset.crownLeagueId = leagueId;
        unmap.disabled = saving;
        actions.append(unmap);
        summary.append(actions);
      }
      section.append(summary);
    } else if (source === "pinnacle") {
      section.append(el("span", "merge-status pending", "等待皇冠侧绑定联赛"));
      section.append(el("span", "merge-league-binding-help", "请先在皇冠视图确认对应联赛，再展开比赛。"));
    } else if (league.id === "--") {
      section.append(el("span", "merge-status pending", "联赛 ID 缺失"));
      section.append(el("span", "merge-league-binding-help", "缺少联赛 ID，暂时无法建立联赛映射。"));
    } else {
      const form = el("div", "merge-league-bind-form");
      form.append(el("span", "merge-status pending", mapping ? "更换联赛绑定" : "待确认联赛"));
      const label = el("label", "merge-picker-label", "选择对应的平博联赛");
      const inputId = `merge-pinnacle-league-${encodeURIComponent(leagueId)}`;
      label.htmlFor = inputId;
      form.append(label);
      const inputRow = el("div", "merge-picker-row");
      const input = el("input", "merge-picker merge-league-picker");
      input.type = "search";
      input.id = inputId;
      input.dataset.crownLeagueId = leagueId;
      input.setAttribute("list", "mergePinnacleLeagueOptions");
      input.setAttribute("autocomplete", "off");
      const selectedId = state.merge.selectedPinnacleLeagueByCrown.get(leagueId)
        || (mapping ? String(mapping.pinnacleId) : "");
      const selected = selectedId
        ? (state.merge.data?.pinnacleLeagues || []).find((item) => String(item.id) === selectedId)
        : null;
      if (selected) input.value = mergeLeagueOptionValue({
        id: String(selected.id),
        name: String(selected.name || "未命名联赛"),
        eventCount: Number(selected.eventCount || 0),
      });
      inputRow.append(input);
      const save = el("button", "button primary merge-confirm-button", mapping ? "保存联赛" : "确认联赛");
      save.type = "button";
      save.dataset.mergeAction = "map-league";
      save.dataset.crownLeagueId = leagueId;
      save.disabled = !selectedId || saving;
      inputRow.append(save);
      if (mapping) {
        const cancel = el("button", "merge-action-button", "取消");
        cancel.type = "button";
        cancel.dataset.mergeAction = "cancel-edit-league";
        cancel.dataset.crownLeagueId = leagueId;
        inputRow.append(cancel);
      }
      form.append(inputRow);
      const helper = el("div", "merge-picker-help");
      helper.dataset.mergeLeagueHelp = leagueId;
      helper.textContent = input.value
        ? "请确认皇冠与平博的联赛对应正确，再绑定比赛。"
        : "按联赛名或联赛 ID 搜索；可参考下方评分候选。";
      form.append(helper);

      const options = suggestions.slice(0, 3);
      if (options.length) {
        const suggestionsBox = el("div", "merge-suggestions merge-league-suggestions");
        suggestionsBox.append(el("span", "merge-suggestions-label", "平博联赛候选"));
        for (const candidate of options) {
          const button = el("button", "merge-suggestion", `${candidate.name} · 联赛 ID ${candidate.id}`);
          button.type = "button";
          button.dataset.mergeAction = "choose-pinnacle-league";
          button.dataset.crownLeagueId = leagueId;
          button.dataset.pinnacleLeagueId = candidate.id;
          button.title = (Array.isArray(candidate.reasons) ? candidate.reasons : []).join(" · ");
          const score = Number(candidate.score);
          button.append(el("small", "merge-suggestion-score", `评分 ${Number.isFinite(score) ? Math.round(score) : 0}/100`));
          suggestionsBox.append(button);
        }
        form.append(suggestionsBox);
      }
      section.append(form);
    }

    return section;
  }

  function renderMergeLeagueGroup(league, source, context) {
    const leagueId = String(league.id);
    const isCrown = source === "crown";
    const mapping = isCrown
      ? context.leagueMappingsByCrown.get(leagueId)
      : context.leagueMappingsByPinnacle.get(leagueId);
    const pairedLeague = mapping
      ? (isCrown
        ? context.pinnacleLeagueById.get(String(mapping.pinnacleId)) || mapping.pinnacleSnapshot
        : context.crownLeagueById.get(String(mapping.crownId)) || mapping.crownSnapshot)
      : null;
    const pairId = mapping ? String(isCrown ? mapping.pinnacleId : mapping.crownId) : "";
    const counterpartEvents = pairId
      ? (isCrown ? context.pinnacleEventsByLeague.get(pairId) : context.crownEventsByLeague.get(pairId)) || []
      : [];
    const open = state.merge.openLeagueBySource[source] === leagueId;
    const section = el("section", `merge-league-group${open ? " is-open" : ""}`);
    section.dataset.leagueId = leagueId;
    section.dataset.source = source;
    const sectionId = `merge-${source}-league-${encodeURIComponent(leagueId)}`;
    section.id = sectionId;

    const header = el("header", "merge-league-heading");
    const toggle = el("button", "merge-league-heading-toggle", "");
    toggle.type = "button";
    toggle.dataset.mergeAction = "toggle-league-events";
    toggle.dataset.source = source;
    toggle.dataset.leagueId = leagueId;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-controls", `${sectionId}-events`);
    toggle.disabled = !mapping;
    const title = el("span", "merge-league-name", league.name);
    toggle.append(title);
    toggle.append(el("span", "merge-league-id", `${isCrown ? "皇冠" : "平博"}联赛 ID ${leagueId}`));
    toggle.append(el("span", "merge-league-count", `${league.events.length} 场`));
    if (mapping) toggle.append(el("span", "merge-status mapped merge-league-status", "已绑定"));
    else toggle.append(el("span", "merge-status pending merge-league-status", "未绑定"));
    toggle.append(el("span", "merge-league-chevron", open ? "收起" : "展开"));
    header.append(toggle);
    section.append(header);

    const leagueCandidates = isCrown ? (context.leagueSuggestionsByCrown.get(leagueId) || []) : [];
    section.append(renderLeagueBinding(league, source, mapping, pairedLeague, leagueCandidates));
    if (mapping && pairId) {
      const eventToggleRow = el("div", "merge-league-events-toggle-row");
      const eventToggle = el("button", "merge-action-button merge-events-toggle", open ? "收起赛事" : `展开并绑定赛事 (${league.events.length})`);
      eventToggle.type = "button";
      eventToggle.dataset.mergeAction = "toggle-league-events";
      eventToggle.dataset.source = source;
      eventToggle.dataset.leagueId = leagueId;
      eventToggle.setAttribute("aria-expanded", String(open));
      eventToggleRow.append(eventToggle);
      if (counterpartEvents.length) eventToggleRow.append(el("span", "merge-league-binding-help", `对应联赛内 ${counterpartEvents.length} 场赛事`));
      section.append(eventToggleRow);
    }

    if (open && mapping && pairId) {
      const list = el("div", "merge-league-events");
      list.id = `${sectionId}-events`;
      const listId = isCrown ? "mergePinnacleOptions" : "mergeCrownOptions";
      const timeKey = isCrown ? "startLabel" : "kickoff";
      league.events.sort((a, b) => String(a[timeKey] || "").localeCompare(String(b[timeKey] || "")));
      for (const event of league.events) {
        if (isCrown) {
          list.append(mergeCrownRow(event, context.mappingsByCrown, context.pinnacleById,
            context.mappingsByPinnacle, context.suggestionsByCrown,
            new Set(counterpartEvents.map((item) => String(item.id))), listId));
        } else {
          const mappedCrownIds = new Set(counterpartEvents.map((item) => String(item.id)));
          const availableCrownIds = new Set(counterpartEvents
            .map((item) => String(item.id))
            .filter((id) => !context.mappingsByCrown.has(id)));
          if (context.mappingsByPinnacle.has(String(event.id))) {
            availableCrownIds.add(String(context.mappingsByPinnacle.get(String(event.id)).crownId));
          }
          list.append(mergeRow(event, context.mappingsByPinnacle, context.crownById,
            context.suggestionsByPinnacle, availableCrownIds, listId));
        }
      }
      section.append(list);
    }
    return section;
  }

  function renderMergeWorkspace() {
    const data = state.merge.data;
    if (!dom.mergeGroups) return;
    dom.mergeError.classList.toggle("hidden", !state.merge.error);
    if (state.merge.error) dom.mergeError.textContent = state.merge.error;
    dom.mergeLoading.classList.toggle("hidden", !state.merge.loading || Boolean(data));
    if (!data) {
      dom.mergeGroups.replaceChildren();
      dom.mergeEmpty.classList.add("hidden");
      return;
    }
    const pinnacleEvents = Array.isArray(data.pinnacleEvents) ? data.pinnacleEvents : [];
    const crownEvents = Array.isArray(data.crownEvents) ? data.crownEvents : [];
    const mappings = mergeMappedByPinnacle(data);
    const mappingsByCrown = new Map((data.mappings || []).map((item) => [String(item.crownId), item]));
    const leagueMappings = Array.isArray(data.leagueMappings) ? data.leagueMappings : [];
    const leagueMappingsByCrown = new Map(leagueMappings.map((item) => [String(item.crownId), item]));
    const leagueMappingsByPinnacle = new Map(leagueMappings.map((item) => [String(item.pinnacleId), item]));
    const crownById = mergeCrownById(data);
    const pinnacleById = new Map(pinnacleEvents.map((item) => [String(item.id), item]));
    if (state.merge.optionsData !== data.crownEvents) {
      state.merge.optionsData = data.crownEvents;
      state.merge.optionByValue = new Map();
      const options = [];
      for (const event of crownEvents) {
        const id = String(event?.id || "");
        if (!id) continue;
        const value = mergeCrownOptionValue(event);
        state.merge.optionByValue.set(value, id);
        const option = el("option");
        option.value = value;
        options.push(option);
      }
      dom.mergeCrownOptions.replaceChildren(...options);
    }
    if (state.merge.pinnacleOptionsData !== data.pinnacleEvents) {
      state.merge.pinnacleOptionsData = data.pinnacleEvents;
      state.merge.pinnacleOptionByValue = new Map();
      const options = [];
      for (const event of pinnacleEvents) {
        const id = String(event?.id || "");
        if (!id) continue;
        const value = mergePinnacleOptionValue(event);
        state.merge.pinnacleOptionByValue.set(value, id);
        const option = el("option");
        option.value = value;
        options.push(option);
      }
      dom.mergePinnacleOptions.replaceChildren(...options);
    }
    const pinnacleLeagues = mergeLeaguesForSource(data, "pinnacle", pinnacleEvents);
    const crownLeagues = mergeLeaguesForSource(data, "crown", crownEvents);
    if (state.merge.leagueOptionsData !== data.pinnacleLeagues) {
      state.merge.leagueOptionsData = data.pinnacleLeagues;
      state.merge.leagueOptionByValue = new Map();
      const options = [];
      for (const league of pinnacleLeagues) {
        const id = String(league.id || "");
        if (!id || id === "--") continue;
        const value = mergeLeagueOptionValue(league);
        state.merge.leagueOptionByValue.set(value, id);
        const option = el("option");
        option.value = value;
        options.push(option);
      }
      dom.mergePinnacleLeagueOptions?.replaceChildren(...options);
    }
    const suggestions = new Map();
    const suggestionsByCrown = new Map();
    for (const suggestion of data.suggestions || []) {
      const id = String(suggestion.pinnacleId);
      if (!suggestions.has(id)) suggestions.set(id, []);
      suggestions.get(id).push(suggestion);
      const crownId = String(suggestion.crownId);
      if (!suggestionsByCrown.has(crownId)) suggestionsByCrown.set(crownId, []);
      suggestionsByCrown.get(crownId).push(suggestion);
    }
    for (const list of suggestions.values()) {
      list.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    }
    for (const list of suggestionsByCrown.values()) {
      list.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    }

    dom.mergePinnacleCount.textContent = numberFormatter.format(pinnacleEvents.length);
    dom.mergeCrownCount.textContent = numberFormatter.format(crownEvents.length);
    dom.mergeMappedCount.textContent = numberFormatter.format(mappings.size);
    const pendingCount = (state.merge.source === "crown" ? crownEvents.length : pinnacleEvents.length) - mappings.size;
    dom.mergePendingCount.textContent = numberFormatter.format(Math.max(0, pendingCount));
    for (const button of dom.mergeSourceButtons) {
      const active = button.dataset.mergeSource === state.merge.source;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    dom.mergeLoading.classList.toggle("hidden", !state.merge.loading || Boolean(data));

    const query = state.merge.search.trim().toLocaleLowerCase("zh-CN");
    const source = state.merge.source;
    const sourceEvents = source === "crown" ? crownEvents : pinnacleEvents;
    const filtered = sourceEvents.filter((event) => {
      const eventId = String(event.id);
      const mapping = source === "crown" ? mappingsByCrown.get(eventId) : mappings.get(eventId);
      const isMapped = Boolean(mapping);
      if (state.merge.filter === "pending" && isMapped) return false;
      if (state.merge.filter === "mapped" && !isMapped) return false;
      if (!query) return true;
      const pairedEvent = source === "crown"
        ? (mapping ? pinnacleById.get(String(mapping.pinnacleId)) || mapping.pinnacleSnapshot : null)
        : (mapping ? crownById.get(String(mapping.crownId)) || mapping.crownSnapshot : null);
      const suggestionText = source === "crown"
        ? (suggestionsByCrown.get(eventId) || [])
          .map((item) => mergeFixtureLabel(pinnacleById.get(String(item.pinnacleId)) || {})).join(" ")
        : (suggestions.get(eventId) || [])
          .map((item) => mergeFixtureLabel(crownById.get(String(item.crownId)) || {})).join(" ");
      const sourceTime = mergeEventTime(event, source);
      const pairedSource = source === "crown" ? "pinnacle" : "crown";
      const pairedTime = pairedEvent ? mergeEventTime(pairedEvent, pairedSource) : "";
      const searchText = [event.id, event.leagueId, event.league, event.name, ...mergeTeams(event), sourceTime,
        mergeEventRawTime(event, source),
        mapping?.pinnacleId, mapping?.crownId, pairedEvent?.id, pairedEvent?.leagueId,
        pairedEvent?.league, pairedEvent?.name, ...mergeTeams(pairedEvent || {}), pairedTime,
        mergeEventRawTime(pairedEvent || {}, pairedSource), suggestionText]
        .filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
      return searchText.includes(query);
    });

    dom.mergeGroups.replaceChildren();
    const sourceName = source === "crown" ? "皇冠" : "平博";
    const hasData = sourceEvents.length > 0;
    const noResults = !filtered.length;
    dom.mergeEmpty.classList.toggle("hidden", hasData && !noResults);
    if (!hasData) {
      dom.mergeEmpty.textContent = `当前没有可显示的${sourceName}赛事。请确认${sourceName}数据已连接后刷新。`;
      dom.mergeEmpty.classList.remove("hidden");
      return;
    }
    if (noResults) {
      dom.mergeEmpty.textContent = "没有符合当前搜索和筛选条件的赛事。";
      dom.mergeEmpty.classList.remove("hidden");
      return;
    }

    const filteredById = new Set(filtered.map((event) => String(event.id)));
    const sourceLeagues = source === "crown" ? crownLeagues : pinnacleLeagues;
    const leagues = sourceLeagues
      .map((league) => ({ ...league, events: (league.events || []).filter((event) => filteredById.has(String(event.id))) }))
      .filter((league) => league.events.length)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || String(a.id).localeCompare(String(b.id), "zh-CN"));
    const context = {
      leagueMappingsByCrown,
      leagueMappingsByPinnacle,
      crownLeagueById: new Map(crownLeagues.map((item) => [String(item.id), item])),
      pinnacleLeagueById: new Map(pinnacleLeagues.map((item) => [String(item.id), item])),
      crownEventsByLeague: new Map(crownLeagues.map((item) => [String(item.id), item.events || []])),
      pinnacleEventsByLeague: new Map(pinnacleLeagues.map((item) => [String(item.id), item.events || []])),
      leagueSuggestionsByCrown: new Map(),
      mappingsByCrown,
      mappingsByPinnacle: mappings,
      crownById,
      pinnacleById,
      suggestionsByCrown,
      suggestionsByPinnacle: suggestions,
    };
    for (const item of data.leagueSuggestions || []) {
      const crownId = String(item.crownLeagueId || "");
      if (!crownId) continue;
      if (!context.leagueSuggestionsByCrown.has(crownId)) context.leagueSuggestionsByCrown.set(crownId, []);
      context.leagueSuggestionsByCrown.get(crownId).push({
        id: String(item.pinnacleLeagueId || ""),
        name: context.pinnacleLeagueById.get(String(item.pinnacleLeagueId || ""))?.name
          || String(item.pinnacleLeagueName || "未命名联赛"),
        score: item.score,
        reasons: item.reasons,
      });
    }
    for (const list of context.leagueSuggestionsByCrown.values()) {
      list.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    }
    for (const league of leagues) {
      dom.mergeGroups.append(renderMergeLeagueGroup(league, source, context));
    }
  }

  async function refreshMerge(force = false) {
    if (!dom.mergeGroups || state.merge.loading) return;
    if (!force && Date.now() - state.merge.lastFetchAt < 15000) return;
    state.merge.loading = true;
    state.merge.error = "";
    const requestSerial = ++state.merge.requestSerial;
    if (!state.merge.data) dom.mergeLoading.classList.remove("hidden");
    try {
      const response = await fetch("/api/merge", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "赛事列表读取失败");
      }
      if (requestSerial !== state.merge.requestSerial) return;
      state.merge.data = payload;
      state.merge.error = payload.crownError
        ? `皇冠赛事读取失败：${payload.crownError}`
        : "";
      state.merge.lastFetchAt = Date.now();
      renderMergeWorkspace();
    } catch (error) {
      if (requestSerial !== state.merge.requestSerial) return;
      state.merge.error = `读取赛事失败：${error.message || "请确认平博和皇冠服务正常后重试。"}`;
      renderMergeWorkspace();
    } finally {
      if (requestSerial === state.merge.requestSerial) {
        state.merge.loading = false;
        dom.mergeLoading.classList.add("hidden");
      }
    }
  }

  async function saveMergeMapping(action, pinnacleId, crownId = "") {
    const id = String(pinnacleId || "");
    if (!id || state.merge.savingPinnacleIds.has(id)) return;
    state.merge.savingPinnacleIds.add(id);
    renderMergeWorkspace();
    try {
      const response = await fetch("/api/merge/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, pinnacleId: id, ...(action === "map" ? { crownId } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "保存合并关系失败");
      }
      state.merge.selectedCrownByPinnacle.delete(id);
      state.merge.editingPinnacleIds.delete(id);
      state.merge.lastFetchAt = 0;
      await refreshMerge(true);
      showToast(action === "unmap" ? "已解除赛事关联" : "赛事关联已保存");
    } catch (error) {
      showToast(`保存失败：${error.message || "请重试"}`);
    } finally {
      state.merge.savingPinnacleIds.delete(id);
      renderMergeWorkspace();
    }
  }

  async function saveMergeLeagueMapping(action, crownLeagueId, pinnacleLeagueId = "") {
    const crownId = String(crownLeagueId || "");
    if (!crownId || state.merge.leagueSavingCrownIds.has(crownId)) return;
    state.merge.leagueSavingCrownIds.add(crownId);
    renderMergeWorkspace();
    try {
      const response = await fetch("/api/merge/league-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          crownLeagueId: crownId,
          ...(action === "map" ? { pinnacleLeagueId: String(pinnacleLeagueId || "") } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "保存联赛绑定失败");
      }
      state.merge.selectedPinnacleLeagueByCrown.delete(crownId);
      state.merge.editingLeagueIds.delete(crownId);
      if (action === "map") {
        state.merge.openLeagueBySource.crown = crownId;
      } else if (state.merge.openLeagueBySource.crown === crownId) {
        state.merge.openLeagueBySource.crown = "";
      }
      state.merge.lastFetchAt = 0;
      await refreshMerge(true);
      showToast(action === "unmap" ? "已解除联赛绑定" : "联赛绑定已保存，现在可以绑定赛事");
    } catch (error) {
      showToast(`保存失败：${error.message || "请重试"}`);
    } finally {
      state.merge.leagueSavingCrownIds.delete(crownId);
      renderMergeWorkspace();
    }
  }

  function showPage(page, updateLocation = true) {
    const target = resolvePage(page);
    const crownView = isCrownView(target);
    state.currentPage = target;
    document.body.classList.toggle("crown-mode", crownView);
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
    if (crownView) {
      ensureCrownFrameLoaded();
    } else {
      setStatus(state.snapshot?.freshness || "no-data");
      if (target === "settings") {
        renderSettingsStatusFromSnapshot(state.snapshot);
        fetchSettings();
      }
    }
    syncPreferenceControls();
    if (target === "merge") refreshMerge();
    syncCrownFrameActivity();
    document.title = {
      home: "皇冠赛事",
      pinnacle: "平博数据",
      crown: "皇冠数据",
      "my-events": "我的赛事",
      merge: "赛事合并",
      settings: "系统设置",
    }[target];
    if (updateLocation) {
      const nextHash = target === "home" ? "" : `#${target}`;
      history.replaceState(null, "", `${location.pathname}${location.search}${nextHash}`);
    }
    window.scrollTo(0, 0);
  }

  function setStatus(freshness) {
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
    dom.sourceText.textContent = snapshot.source?.capturePath || "capture.jsonl";
    setStatus(snapshot.freshness);
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
    button.dataset.eventId = String(event.id);
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
    state.eventNodes.set(String(event.id), button);
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
      .slice(0, state.changeLimit)
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
    for (const change of state.changes.slice(0, state.changeLimit)) {
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
    renderSettingsStatusFromSnapshot(snapshot);
  }

  async function refresh(force = false) {
    if (state.refreshing) return;
    state.refreshing = true;
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
        setStatus("offline");
      }
      if (force) showToast(`刷新失败：${error.message || "无法连接看板服务"}`);
    } finally {
      window.clearTimeout(timer);
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
    writePreference(SETTINGS_PREF_KEYS.filter, state.filter);
    if (dom.settingsDefaultFilter) dom.settingsDefaultFilter.value = state.filter;
    for (const chip of dom.metadataFilters.querySelectorAll("[data-filter]")) {
      chip.classList.toggle("active", chip === button);
    }
    renderEvents(true);
  });

  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    writePreference(SETTINGS_PREF_KEYS.sort, state.sort);
    if (dom.settingsDefaultSort) dom.settingsDefaultSort.value = state.sort;
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
    writePreference(SETTINGS_PREF_KEYS.history, state.historyHours);
    if (dom.settingsDefaultHistory) dom.settingsDefaultHistory.value = String(state.historyHours);
    state.historyPoints = [];
    state.historySummary = null;
    state.historyLastFetch = 0;
    clearHistoryChart();
    fetchHistory(true);
  });

  dom.historyRefreshButton.addEventListener("click", () => {
    fetchHistory(true);
  });

  dom.settingsDefaultPage?.addEventListener("change", () => {
    writePreference(SETTINGS_PREF_KEYS.page, dom.settingsDefaultPage.value);
  });

  dom.settingsDefaultSort?.addEventListener("change", () => {
    state.sort = dom.settingsDefaultSort.value;
    writePreference(SETTINGS_PREF_KEYS.sort, state.sort);
    if (dom.sortSelect) dom.sortSelect.value = state.sort;
    renderEvents(true);
  });

  dom.settingsDefaultFilter?.addEventListener("change", () => {
    state.filter = dom.settingsDefaultFilter.value;
    writePreference(SETTINGS_PREF_KEYS.filter, state.filter);
    for (const chip of dom.metadataFilters?.querySelectorAll("[data-filter]") || []) {
      chip.classList.toggle("active", chip.dataset.filter === state.filter);
    }
    renderEvents(true);
  });

  dom.settingsDefaultHistory?.addEventListener("change", () => {
    state.historyHours = Number(dom.settingsDefaultHistory.value) || 24;
    writePreference(SETTINGS_PREF_KEYS.history, state.historyHours);
    if (dom.historyRangeSelect) dom.historyRangeSelect.value = String(state.historyHours);
    state.historyPoints = [];
    state.historySummary = null;
    state.historyLastFetch = 0;
    clearHistoryChart();
    fetchHistory(true);
  });

  dom.settingsChangeLimit?.addEventListener("change", () => {
    state.changeLimit = Number(dom.settingsChangeLimit.value) || 8;
    writePreference(SETTINGS_PREF_KEYS.changeLimit, state.changeLimit);
    state.changesSignature = "";
    renderChanges(true);
  });

  dom.settingsRefreshButton?.addEventListener("click", () => {
    fetchSettings(true);
    refresh(true);
    fetchMetadataStatus(true);
  });

  dom.settingsSaveButton?.addEventListener("click", () => {
    saveSettings();
    saveSettingsPreferences();
  });

  dom.settingsMetadataCheckButton?.addEventListener("click", () => {
    runSettingsMaintenance("metadata");
  });

  dom.settingsMetadataRepairButton?.addEventListener("click", () => {
    runSettingsMaintenance("repair");
  });

  dom.settingsBackupButton?.addEventListener("click", () => {
    runSettingsMaintenance("backup");
  });

  dom.settingsIntegrityButton?.addEventListener("click", () => {
    runSettingsMaintenance("integrity");
  });

  dom.primaryNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button) showPage(button.dataset.page);
  });

  dom.mergeRefreshButton?.addEventListener("click", () => {
    refreshMerge(true);
  });

  for (const button of dom.mergeSourceButtons) {
    button.addEventListener("click", () => {
      state.merge.source = button.dataset.mergeSource === "pinnacle" ? "pinnacle" : "crown";
      state.merge.search = "";
      state.merge.filter = "all";
      if (dom.mergeSearch) dom.mergeSearch.value = "";
      for (const filter of dom.mergeFilters?.querySelectorAll("[data-merge-filter]") || []) {
        const active = filter.dataset.mergeFilter === "all";
        filter.classList.toggle("active", active);
        filter.setAttribute("aria-pressed", String(active));
      }
      renderMergeWorkspace();
    });
  }

  dom.mergeSearch?.addEventListener("input", () => {
    state.merge.search = dom.mergeSearch.value;
    const cursor = dom.mergeSearch.selectionStart;
    renderMergeWorkspace();
    dom.mergeSearch.focus();
    if (cursor !== null) dom.mergeSearch.setSelectionRange(cursor, cursor);
  });

  dom.mergeFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-merge-filter]");
    if (!button) return;
    state.merge.filter = button.dataset.mergeFilter;
    for (const filter of dom.mergeFilters.querySelectorAll("[data-merge-filter]")) {
      const active = filter === button;
      filter.classList.toggle("active", active);
      filter.setAttribute("aria-pressed", String(active));
    }
    renderMergeWorkspace();
  });

  dom.mergeGroups?.addEventListener("input", (event) => {
    const leagueInput = event.target.closest(".merge-league-picker");
    if (leagueInput) {
      const crownLeagueId = String(leagueInput.dataset.crownLeagueId || "");
      const selectedPinnacleLeagueId = state.merge.leagueOptionByValue.get(leagueInput.value.trim()) || "";
      if (selectedPinnacleLeagueId) {
        state.merge.selectedPinnacleLeagueByCrown.set(crownLeagueId, selectedPinnacleLeagueId);
      } else {
        state.merge.selectedPinnacleLeagueByCrown.delete(crownLeagueId);
      }
      const form = leagueInput.closest(".merge-league-bind-form");
      const saveButton = form?.querySelector('[data-merge-action="map-league"]');
      if (saveButton) saveButton.disabled = !selectedPinnacleLeagueId || state.merge.leagueSavingCrownIds.has(crownLeagueId);
      const help = form?.querySelector("[data-merge-league-help]");
      if (help) {
        help.textContent = selectedPinnacleLeagueId
          ? "请确认皇冠与平博的联赛对应正确，再绑定比赛。"
          : leagueInput.value
            ? "请从下拉候选中选择完整联赛，或继续输入关键词缩小列表。"
            : "按联赛名或联赛 ID 搜索；可参考下方评分候选。";
      }
      return;
    }
    const input = event.target.closest("[data-pinnacle-id].merge-picker");
    if (input) {
      const id = input.dataset.pinnacleId;
      const selectedCrownId = state.merge.optionByValue.get(input.value.trim()) || "";
      const mappings = mergeMappedByPinnacle(state.merge.data);
      const occupiedBy = selectedCrownId
        ? [...mappings.values()].find((mapping) =>
          String(mapping.crownId) === selectedCrownId && String(mapping.pinnacleId) !== id,
        )
        : null;
      const canSelect = Boolean(selectedCrownId && !occupiedBy);
      if (canSelect) state.merge.selectedCrownByPinnacle.set(id, selectedCrownId);
      else state.merge.selectedCrownByPinnacle.delete(id);
      const row = input.closest(".merge-row");
      const saveButton = row?.querySelector('[data-merge-action="map"]');
      if (saveButton) saveButton.disabled = !canSelect || state.merge.savingPinnacleIds.has(id);
      const help = row?.querySelector(".merge-picker-help");
      if (help) {
        help.textContent = occupiedBy
          ? "这场皇冠赛事已关联到另一场平博赛事，请选择其他候选。"
          : input.value && !canSelect
            ? "请从下拉候选中选择完整赛事，或继续输入关键词缩小列表。"
            : "可按队名、联赛或赛事 ID 搜索皇冠赛事；核对联赛和开赛时间后再确认。";
      }
      return;
    }

    const crownInput = event.target.closest("[data-crown-id].merge-pinnacle-picker");
    if (!crownInput) return;
    const crownId = crownInput.dataset.crownId;
    const selectedPinnacleId = state.merge.pinnacleOptionByValue.get(crownInput.value.trim()) || "";
    const mappings = mergeMappedByPinnacle(state.merge.data);
    const occupiedBy = selectedPinnacleId ? mappings.get(selectedPinnacleId) : null;
    const canSelect = Boolean(selectedPinnacleId && (!occupiedBy || String(occupiedBy.crownId) === crownId));
    if (canSelect) state.merge.selectedPinnacleByCrown.set(crownId, selectedPinnacleId);
    else state.merge.selectedPinnacleByCrown.delete(crownId);
    const row = crownInput.closest(".merge-row");
    const saveButton = row?.querySelector('[data-merge-action="map-from-crown"]');
    if (saveButton) saveButton.disabled = !canSelect || state.merge.savingPinnacleIds.has(selectedPinnacleId);
    const help = row?.querySelector("[data-merge-crown-help]");
    if (help) {
      help.textContent = occupiedBy
        ? "这场平博赛事已关联其他皇冠赛事，请先在平博视图解除原关联。"
        : crownInput.value && !canSelect
          ? "请从下拉候选中选择完整赛事，或继续输入关键词缩小列表。"
          : "可按队名、联赛或赛事 ID 搜索平博赛事；核对联赛和开赛时间后再确认。";
    }
  });

  dom.mergeGroups?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-merge-action]");
    if (!button) return;
    const pinnacleId = String(button.dataset.pinnacleId || "");
    const action = button.dataset.mergeAction;
    if (action === "toggle-league-events") {
      const source = button.dataset.source === "pinnacle" ? "pinnacle" : "crown";
      const leagueId = String(button.dataset.leagueId || "");
      const mapping = source === "crown"
        ? new Map((state.merge.data?.leagueMappings || []).map((item) => [String(item.crownId), item])).get(leagueId)
        : new Map((state.merge.data?.leagueMappings || []).map((item) => [String(item.pinnacleId), item])).get(leagueId);
      if (!mapping) return;
      state.merge.openLeagueBySource[source] = state.merge.openLeagueBySource[source] === leagueId ? "" : leagueId;
      renderMergeWorkspace();
      return;
    }
    if (action === "choose-pinnacle-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      const pinnacleLeagueId = String(button.dataset.pinnacleLeagueId || "");
      const league = (state.merge.data?.pinnacleLeagues || []).find((item) => String(item.id) === pinnacleLeagueId);
      if (crownLeagueId && pinnacleLeagueId) {
        state.merge.selectedPinnacleLeagueByCrown.set(crownLeagueId, pinnacleLeagueId);
        renderMergeWorkspace();
        const picker = document.getElementById(`merge-pinnacle-league-${encodeURIComponent(crownLeagueId)}`);
        if (picker && league) {
          picker.value = mergeLeagueOptionValue(league);
          picker.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return;
    }
    if (action === "edit-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      state.merge.editingLeagueIds.add(crownLeagueId);
      renderMergeWorkspace();
      return;
    }
    if (action === "cancel-edit-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      state.merge.editingLeagueIds.delete(crownLeagueId);
      state.merge.selectedPinnacleLeagueByCrown.delete(crownLeagueId);
      renderMergeWorkspace();
      return;
    }
    if (action === "map-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      const pinnacleLeagueId = state.merge.selectedPinnacleLeagueByCrown.get(crownLeagueId) || "";
      if (!pinnacleLeagueId) {
        showToast("请先选择对应的平博联赛");
        return;
      }
      saveMergeLeagueMapping("map", crownLeagueId, pinnacleLeagueId);
      return;
    }
    if (action === "unmap-league") {
      saveMergeLeagueMapping("unmap", String(button.dataset.crownLeagueId || ""));
      return;
    }
    if (action === "edit") {
      state.merge.editingPinnacleIds.add(pinnacleId);
      renderMergeWorkspace();
      return;
    }
    if (action === "cancel-edit") {
      state.merge.editingPinnacleIds.delete(pinnacleId);
      state.merge.selectedCrownByPinnacle.delete(pinnacleId);
      renderMergeWorkspace();
      return;
    }
    if (action === "unmap") {
      saveMergeMapping("unmap", pinnacleId);
      return;
    }
    if (action === "choose") {
      const crownId = String(button.dataset.crownId || "");
      state.merge.selectedCrownByPinnacle.set(pinnacleId, crownId);
      renderMergeWorkspace();
      const picker = document.getElementById(`merge-crown-picker-${pinnacleId}`);
      const crown = mergeCrownById(state.merge.data).get(crownId);
      if (picker && crown) {
        picker.value = mergeCrownOptionValue(crown);
        picker.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (action === "choose-pinnacle") {
      const crownId = String(button.dataset.crownId || "");
      const pinnacleId = String(button.dataset.pinnacleId || "");
      state.merge.selectedPinnacleByCrown.set(crownId, pinnacleId);
      renderMergeWorkspace();
      const picker = document.getElementById(`merge-pinnacle-picker-${crownId}`);
      const pinnacle = new Map((state.merge.data?.pinnacleEvents || []).map((item) => [String(item.id), item])).get(pinnacleId);
      if (picker && pinnacle) {
        picker.value = mergePinnacleOptionValue(pinnacle);
        picker.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (action === "map") {
      const crownId = state.merge.selectedCrownByPinnacle.get(pinnacleId) || "";
      if (!crownId) {
        showToast("请先从候选列表中选择一场皇冠赛事");
        return;
      }
      const occupied = [...mergeMappedByPinnacle(state.merge.data).values()].some((mapping) =>
        String(mapping.crownId) === crownId && String(mapping.pinnacleId) !== pinnacleId,
      );
      if (occupied) {
        showToast("这场皇冠赛事已关联到另一场平博赛事，请刷新后重新选择");
        state.merge.selectedCrownByPinnacle.delete(pinnacleId);
        renderMergeWorkspace();
        return;
      }
      saveMergeMapping("map", pinnacleId, crownId);
      return;
    }
    if (action === "map-from-crown") {
      const crownId = String(button.dataset.crownId || "");
      const pinnacleId = state.merge.selectedPinnacleByCrown.get(crownId) || "";
      if (!pinnacleId) {
        showToast("请先从候选列表中选择一场平博赛事");
        return;
      }
      const existing = mergeMappedByPinnacle(state.merge.data).get(pinnacleId);
      if (existing && String(existing.crownId) !== crownId) {
        showToast("这场平博赛事已关联其他皇冠赛事，请先在平博视图解除原关联");
        return;
      }
      saveMergeMapping("map", pinnacleId, crownId);
    }
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

  for (const frame of dom.crownFrames) {
    frame.addEventListener("load", () => {
      postCrownCommandTo(frame, "set-paused", {
        paused: frame !== activeCrownFrame(),
      });
    });
  }

  window.addEventListener("message", (event) => {
    const activeFrame = activeCrownFrame();
    if (event.source === activeFrame?.contentWindow) {
      // Keep iframe messages scoped to the active Crown view. The parent no
      // longer exposes manual pause/refresh controls, so there is no UI state
      // to mirror here.
    }
  });

  dom.metadataCheckButton.addEventListener("click", () => {
    startMetadataSync(false);
  });

  dom.metadataRepairButton.addEventListener("click", () => {
    startMetadataSync(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refresh();
      fetchMetadataStatus();
    }
  });

  const preferredPage = loadSettingsPreferences();
  const initialPage = location.hash.slice(1) ? resolvePage(location.hash.slice(1)) : preferredPage;
  showPage(initialPage, false);
  syncPreferenceControls();
  refresh(true);
  fetchMetadataStatus();
  window.setInterval(() => {
    if (!document.hidden) {
      refresh();
      fetchMetadataStatus();
      if (state.currentPage === "merge") refreshMerge();
    }
  }, POLL_INTERVAL);
})();
