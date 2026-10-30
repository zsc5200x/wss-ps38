import { numberFormatter } from "../constants.js";
import { dom } from "../dom.js";
import { el } from "../shared/dom.js";
import { iconArrow, parseDate, formatClock, formatShortDate, formatPrice, rowHongKong, historyHongKong, decimalToHongKong, formatDelta, quoteAgeInfo, handicapSideLine, countMarketGroups, marketLabel, stageLabel, formatHandicapLine, formatTotalLine, teamNames, selectionLabel } from "../shared/format.js";
import { state } from "../state.js";

export function createSparkline(history) {
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

export function createDelta(row) {
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

export function createQuoteCard(row, label = "", detail = "", compact = false) {
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
  const age = quoteAgeInfo(row.capturedAt, state.snapshot?.serverTime);
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

export function createMarketHeader(title, detail, rows) {
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

export function renderThreeWayMarket(rows) {
  const section = el("section", "market-block");
  section.setAttribute("aria-label", "胜平负盘口");
  section.append(createMarketHeader("胜平负", "1X2 · 全场 · 香港赔率", rows));

  const [home, away] = teamNames(state.selectedEvent?.name);
  // Pinnacle's feed numbers the 1X2 selections 0=home, 1=away, 2=draw.
  const definitions = [
    { option: "0", label: "主胜", detail: home },
    { option: "2", label: "和局", detail: "双方打平" },
    { option: "1", label: "客胜", detail: away },
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

export function createLineHeader(lineLabel, sideLabels) {
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

export function buildLineGroups(rows, keyForRow, lineForRow) {
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

export function renderHandicapMarket(rows) {
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

export function renderTotalsMarket(rows) {
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

export function renderMarketOverview(rows) {
  const validRows = rows.filter((row) => row.quoted && rowHongKong(row) !== null);
  const freshRows = validRows.filter((row) => {
    const age = quoteAgeInfo(row.capturedAt, state.snapshot?.serverTime);
    return age.seconds !== null && age.seconds <= 60;
  });
  const latestRow = rows.reduce((latest, row) => {
    const current = parseDate(row.capturedAt);
    if (!current) return latest;
    if (!latest || current > latest) return current;
    return latest;
  }, null);
  const latestAge = latestRow ? quoteAgeInfo(latestRow.toISOString(), state.snapshot?.serverTime) : { text: "—", level: "unknown" };

  dom.marketGroups.textContent = numberFormatter.format(countMarketGroups(rows));
  dom.marketQuotes.textContent = `${numberFormatter.format(validRows.length)} / ${numberFormatter.format(rows.length)}`;
  dom.marketFresh.textContent = `${numberFormatter.format(freshRows.length)} / ${numberFormatter.format(validRows.length)}`;
  dom.marketLastUpdate.textContent = latestAge.text;
  dom.marketLastUpdate.className = latestAge.level === "aged" ? "aged" : latestAge.level;
}

export function renderOdds() {
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

export function renderChanges(force = false) {
  // Newest incremental odds changes first; the rail shows the latest window.
  const ordered = state.changes.slice().sort((a, b) => Number(b.serial) - Number(a.serial));
  const visible = ordered.slice(0, state.changeLimit);
  const signature = visible.map((change) => change.serial).join("|");
  if (!force && signature === state.changesSignature) return;
  const previous = new Set(String(state.changesSignature || "").split("|").filter(Boolean));
  const firstRender = !state.changesSignature;
  const previousScrollTop = dom.changeFeed.scrollTop;
  const keepTop = previousScrollTop <= 8;
  state.changesSignature = signature;
  dom.changeCount.textContent = numberFormatter.format(state.changes.length);
  dom.changeFeed.replaceChildren();
  if (!state.changes.length) {
    dom.changeFeed.append(el("div", "change-empty", "等待新的赔率变化…"));
  } else {
    const fragment = document.createDocumentFragment();
    for (const change of visible) {
      const card = el("button", "change-card");
      card.type = "button";
      card.dataset.eventId = change.eventId;
      if (!firstRender && !previous.has(String(change.serial))) card.classList.add("is-new");
      const selection = selectionLabel(change, change.eventName);
      const hasOld = change.old !== null && change.old !== undefined;
      const hasNew = change.new !== null && change.new !== undefined;
      const stateClass = hasNew ? (change.direction || "flat") : "suspended";
      card.classList.add(stateClass);
      card.title = `${change.eventName} · ${marketLabel(change.market)} · ${stageLabel(change.stage)} · ${selection.primary}`;
      const top = el("div", "change-card-top");
      top.append(
        el("span", "change-card-event", change.eventName || `赛事 ${change.eventId}`),
        el(
          "span",
          `change-direction ${stateClass}`,
          hasNew ? (change.direction === "new" ? "新" : iconArrow(change.direction)) : "撤"
        )
      );
      const value = el("div", "change-card-value");
      value.append(
        el("span", "old", hasOld ? formatPrice(decimalToHongKong(change.old)) : "—"),
        el("span", "arrow", "→"),
        el("span", `new ${change.direction}`, hasNew ? formatPrice(decimalToHongKong(change.new)) : "撤盘")
      );
      const bottom = el("div", "change-card-bottom");
      bottom.append(
        el(
          "span",
          "change-card-market",
          `${marketLabel(change.market)} · ${stageLabel(change.stage)} · ${selection.primary}`
        ),
        el("span", "change-card-time", formatClock(change.capturedAt))
      );
      card.append(top, value, bottom);
      fragment.append(card);
    }
    dom.changeFeed.append(fragment);
    dom.changeFeed.scrollTop = keepTop ? 0 : previousScrollTop;
  }
  if (dom.changeUpdatedAt) {
    dom.changeUpdatedAt.textContent = state.changes.length
      ? `最新 ${formatClock(ordered[0].capturedAt)} · ${visible.length}/${state.changes.length}`
      : "等待变化";
  }
}
