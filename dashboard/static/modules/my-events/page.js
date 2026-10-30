import { el } from "../shared/dom.js";
import { fetchJson } from "../shared/http.js";
import { state } from "../state.js";

const PAGE_SIZE = 50;
const BANNER_LIMIT = 5;
const BANNER_TTL_MS = 30000;

const $ = (id) => document.getElementById(id);

const RESULT_LABELS = {
  WIN: "胜",
  LOSE: "负",
  WIN_HALF: "赢半",
  LOSE_HALF: "输半",
  DRAW: "平",
  REFUNDED: "退还",
  OPEN: "未结算",
  "": "—",
};

function myEvents() {
  return state.myEvents;
}

function setStatus(text) {
  const node = $("myEventsStatus");
  if (node) node.textContent = text;
}

function formatNumber(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatMoney(value, _currency, digits = 0) {
  return formatNumber(value, digits);
}

function formatOdds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "—";
}

function formatSigned(value, _currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const sign = number > 0 ? "+" : number < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(number), 2)}`;
}

function formatMember(row) {
  const code = row.member_user_code || "—";
  return row.member_name ? `${code} · ${row.member_name}` : code;
}

/** Render 0.25 / 0.75 as the Chinese quarter-line pair, e.g. 3.25 -> 3/3.5. */
function lineText(value) {
  const number = Math.abs(Number(value));
  if (!Number.isFinite(number)) return "";
  const whole = Math.floor(number);
  const fraction = Math.round((number - whole) * 100) / 100;
  if (fraction === 0) return String(whole);
  if (fraction === 0.5) return `${whole}.5`;
  if (fraction === 0.25) return `${whole}/${whole}.5`;
  if (fraction === 0.75) return `${whole}.5/${whole + 1}`;
  return String(number);
}

function signedLine(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const text = lineText(number);
  if (number > 0) return `+${text}`;
  if (number < 0) return `-${text}`;
  return "0";
}

function splitTeams(value) {
  const text = String(value || "");
  const parts = text.split(/\s*-\s*vs\s*-\s*/i);
  if (parts.length === 2) return [parts[0].trim(), parts[1].trim()];
  return [text.trim(), ""];
}

/** Convert a raw market into the Chinese betting notation the user reads. */
function formatPick(row) {
  const market = String(row.market || "").trim();
  const lower = market.toLowerCase();
  const [home, away] = splitTeams(row.teams);

  if (lower.startsWith("ou") || market.startsWith("大小")) {
    const prefix = ["小", "UNDER"].includes(row.selection) ? "小" : "大";
    return `${prefix}${lineText(row.handicap)}`;
  }
  if (lower.startsWith("hdp") || market.startsWith("让球")) {
    const isHome = ["主", "HOME"].includes(row.selection);
    const team = isHome ? home : away;
    return `${team || (isHome ? "主队" : "客队")}${signedLine(row.handicap)}`;
  }
  if (lower.startsWith("1x2") || market.startsWith("独赢")) {
    return row.selection || "独赢";
  }
  if (lower.startsWith("or")) {
    return row.selection || market;
  }
  const label = market.replace(/\s*0(?:\.0+)?$/, "").trim();
  return [label, row.selection].filter(Boolean).join(" ") || "—";
}

function formatTime(row, basis = "created", tzMinutes = -240) {
  const value = basis === "settled" ? row.settled_at : (row.created_ms ?? row.created_at);
  if (value == null || value === "") return "—";
  const date = new Date(typeof value === "number" ? value : Date.parse(value));
  if (Number.isNaN(date.getTime())) return "—";
  const timeZone = Number(tzMinutes) === -240 ? "Etc/GMT+4" : "Asia/Shanghai";
  return date.toLocaleString("zh-CN", { hour12: false, timeZone });
}

function resultClass(result) {
  const key = String(result || "open").toLowerCase().replace(/_/g, "-");
  return `result-badge result-${key}`;
}

function cell(text, className) {
  return el("td", className, text);
}

function renderRows() {
  const body = $("myEventsBody");
  if (!body) return;
  const rows = myEvents().rows;
  const basis = myEvents().basis || "created";
  const tzLabel = Number(myEvents().tz) === -240 ? "GMT-4" : "GMT+8";
  const timeHeader = $("myEventsTimeHeader");
  if (timeHeader) {
    timeHeader.textContent = `${basis === "settled" ? "结算时间" : "下单时间"} (${tzLabel})`;
  }
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.className = `my-events-row status-${String(row.status || "").toLowerCase()}`;

    const winLoss = row.win_loss == null ? null : Number(row.win_loss);
    const winLossCell = cell(
      row.status === "SETTLED" && winLoss != null ? formatSigned(winLoss) : "—",
      "winloss",
    );
    if (winLoss != null && winLoss > 0) winLossCell.classList.add("positive");
    else if (winLoss != null && winLoss < 0) winLossCell.classList.add("negative");

    const resultCell = el("td", "result");
    resultCell.append(el("span", resultClass(row.result), RESULT_LABELS[row.result] ?? "—"));
    if (row.inplay) resultCell.append(el("span", "inplay", " · 滚球"));

    tr.append(
      cell(row.league || "—", "league"),
      cell(row.teams || "—", "teams"),
      cell(formatPick(row), "market"),
      cell(formatOdds(row.odds), "odds"),
      cell(formatMoney(row.stake), "stake"),
      winLossCell,
      cell(row.order_id || "—", "order"),
      cell(row.agent_code || "—", "agent"),
      cell(formatMember(row), "member"),
      resultCell,
      cell(formatTime(row, basis, myEvents().tz), "time"),
    );
    body.append(tr);
  }
  const empty = $("myEventsEmpty");
  if (empty) empty.classList.toggle("hidden", rows.length > 0);
  const more = $("myEventsMore");
  if (more) more.classList.toggle("hidden", rows.length >= myEvents().total);
}

function renderAgentOptions() {
  const select = $("myEventsAgent");
  if (!select) return;
  const agents = myEvents().agents || [];
  const subtitle = $("myEventsSubtitle");
  if (subtitle && agents.length) {
    const label = { OPEN: "未结算订单", SETTLED: "已结算订单", ALL: "全部订单" }[myEvents().status] || "全部订单";
    subtitle.textContent = `${label} · ${agents.map((agent) => agent.code).join(" / ")}`;
  }
  const signature = agents.map((agent) => agent.code).join(",");
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const current = select.value;
  select.replaceChildren(new Option("全部代理", ""));
  for (const agent of agents) {
    select.append(new Option(agent.code, agent.code));
  }
  select.value = current;
}

function setStat(id, text, tone = "") {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  node.classList.remove("positive", "negative", "neutral");
  if (tone) node.classList.add(tone);
}

function renderAgents(agents, payload = {}) {
  const box = $("myEventsAgents");
  if (!box) return;
  box.replaceChildren();
  let stakeSum = 0;
  let netSum = 0;
  let orderSum = 0;
  for (const agent of agents) {
    const card = el("article", "my-events-agent");
    card.append(el("span", "my-events-agent-code", agent.agent_code || "—"));
    card.append(el("strong", "", formatMoney(agent.stake)));
    const net = Number(agent.net);
    const foot = el(
      "span",
      "my-events-agent-foot",
      `${formatNumber(agent.orders)} 单 · 输赢 ${formatSigned(net)}`,
    );
    if (net > 0) foot.classList.add("positive");
    else if (net < 0) foot.classList.add("negative");
    card.append(foot);
    box.append(card);
    stakeSum += Number(agent.stake) || 0;
    netSum += net || 0;
    orderSum += Number(agent.orders) || 0;
  }
  const total = $("myEventsAgentTotal");
  if (total) {
    const totalStake = Number(payload.total_stake) || 0;
    const diff = Math.abs(stakeSum - totalStake);
    total.classList.toggle("mismatch", agents.length > 0 && diff > 0.01);
    total.textContent = agents.length
      ? `${agents.length} 个代理合计 · ${formatNumber(orderSum)} 单 · 投注 ${formatMoney(stakeSum)} · 输赢 ${formatSigned(netSum)}`
        + (diff > 0.01 ? ` · 与顶部差 ${formatMoney(diff)}` : "")
      : "";
  }
}

function renderSummary(payload) {
  setStat("myEventsTotalStake", formatMoney(payload.total_stake));
  setStat(
    "myEventsTotalOrders",
    `${formatNumber(payload.orders)} 单 · 已结算 ${formatNumber(payload.settled)} · 未结算 ${formatNumber(payload.open)}`,
  );
  const net = Number(payload.net);
  setStat(
    "myEventsNet",
    formatSigned(net),
    net > 0 ? "positive" : net < 0 ? "negative" : "neutral",
  );
  setStat(
    "myEventsWinLose",
    `赢 ${formatNumber(payload.win_count)} · 输 ${formatNumber(payload.lose_count)} · 赢半 ${formatNumber(payload.win_half_count)} · 输半 ${formatNumber(payload.lose_half_count)}`,
  );
  setStat("myEventsOpenCount", formatNumber(payload.open));
  setStat("myEventsOpenStake", formatMoney(payload.open_stake));
  setStat("myEventsSettledCount", formatNumber(payload.settled));
  setStat("myEventsSettledStake", formatMoney(payload.settled_stake));
  renderAgents(payload.agents || [], payload);
  const scope = $("myEventsScope");
  if (scope) {
    const current = myEvents();
    const agent = current.agent ? ` · ${current.agent}` : "";
    const basisLabel = current.basis === "settled" ? "结算时间" : "下单时间";
    const tzLabel = Number(current.tz) === -240 ? "GMT-4" : "GMT+8";
    let rangeLabel = "全部时间";
    if (current.from && current.to && current.from === current.to) rangeLabel = current.from;
    else if (current.from || current.to) {
      rangeLabel = `${current.from || "开始"} ~ ${current.to || "现在"}`;
    }
    scope.textContent = `${basisLabel} · ${tzLabel} · ${rangeLabel}${agent}`;
  }
}

function summaryQuery() {
  const current = myEvents();
  const params = new URLSearchParams();
  if (current.agent) params.set("agent", current.agent);
  if (current.from) params.set("from", current.from);
  if (current.to) params.set("to", current.to);
  params.set("basis", current.basis || "created");
  params.set("tz", String(current.tz ?? 480));
  return params.toString();
}

export function clearMyEventsBanner() {
  const banner = $("myEventsBanner");
  myEvents().banner = [];
  window.clearTimeout(myEvents().bannerTimer);
  if (banner) {
    banner.replaceChildren();
    banner.classList.add("hidden");
  }
}

export function showMyEventsBanner(events) {
  const banner = $("myEventsBanner");
  if (!banner || !Array.isArray(events) || !events.length) return;
  const current = myEvents();
  current.banner = [...events, ...current.banner].slice(0, BANNER_LIMIT);
  banner.replaceChildren();
  for (const event of current.banner) {
    const chip = el("span", "my-events-banner-chip");
    chip.append(el("b", "", "新单 "));
    chip.append(document.createTextNode(
      `${event.member_user_code || "会员"} · ${event.agent_code || "代理"} · `
      + `${event.league || "联赛"} · ${event.teams || "比赛"} · `
      + `${[event.market, event.selection].filter(Boolean).join(" ") || "盘口"} · `
      + `水位 ${formatOdds(event.odds)} · 金额 ${formatMoney(event.stake)} · `
      + `#${event.order_id || "—"}`
    ));
    banner.append(chip);
  }
  const close = el("button", "my-events-banner-close", "关闭");
  close.type = "button";
  close.addEventListener("click", clearMyEventsBanner);
  banner.append(close);
  banner.classList.remove("hidden");
  window.clearTimeout(current.bannerTimer);
  current.bannerTimer = window.setTimeout(clearMyEventsBanner, BANNER_TTL_MS);
}

export function myEventsQuery() {
  const current = myEvents();
  const params = new URLSearchParams();
  params.set("status", current.status);
  if (current.agent) params.set("agent", current.agent);
  if (current.search) params.set("search", current.search);
  if (current.from) params.set("from", current.from);
  if (current.to) params.set("to", current.to);
  params.set("basis", current.basis || "created");
  params.set("tz", String(current.tz ?? 480));
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(current.offset));
  return params.toString();
}

let listRequestId = 0;

export async function refreshMyEvents({ reset = false, silent = false } = {}) {
  const current = myEvents();
  if (current.loading && !reset) return;
  const requestId = ++listRequestId;
  if (reset) current.offset = 0;
  current.loading = true;
  if (!silent) setStatus("读取中…");
  try {
    const { response, payload } = await fetchJson(
      `/api/my-events?${myEventsQuery()}`,
      { cache: "no-store" },
      { timeoutMs: 10000, allowInvalidJson: true },
    );
    if (requestId !== listRequestId) return;
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    current.rows = reset ? rows : current.rows.concat(rows);
    current.total = Number(payload.total || 0);
    current.ready = Boolean(payload.ready);
    if (Array.isArray(payload.agents)) current.agents = payload.agents;
    renderAgentOptions();
    renderRows();
    const count = $("myEventsCount");
    if (count) count.textContent = `${current.total} 单`;
    setStatus(current.ready ? `共 ${current.total} 单` : "采集器未启动");
  } catch (error) {
    if (!silent) setStatus(`读取失败：${error.message || "请求失败"}`);
  } finally {
    if (requestId === listRequestId) current.loading = false;
  }
}

let summaryRequestId = 0;

export async function refreshMyEventsSummary() {
  const requestId = ++summaryRequestId;
  try {
    const { response, payload } = await fetchJson(
      `/api/my-events/summary?${summaryQuery()}`,
      { cache: "no-store" },
      { timeoutMs: 10000, allowInvalidJson: true },
    );
    if (requestId !== summaryRequestId) return;
    if (!response.ok || payload.ok === false) return;
    if (payload.ready === false) return;
    renderSummary(payload);
  } catch (_error) {
    // Keep the previous cards when the local summary query is unavailable.
  }
}

export async function refreshMyEventsAll(options = {}) {
  await Promise.all([refreshMyEvents(options), refreshMyEventsSummary()]);
}

export async function loadMoreMyEvents() {
  const current = myEvents();
  if (current.loading) return;
  current.offset = current.rows.length;
  await refreshMyEvents();
}

export async function pollMyEventsEvents() {
  const current = myEvents();
  const url = current.lastCursor == null
    ? "/api/my-events/events"
    : `/api/my-events/events?cursor=${current.lastCursor}`;
  try {
    const { response, payload } = await fetchJson(
      url,
      { cache: "no-store" },
      { timeoutMs: 8000, allowInvalidJson: true },
    );
    if (!response.ok || payload.ok === false) return;
    if (payload.ready === false) {
      setStatus("采集器未启动");
      return;
    }
    current.lastCursor = payload.cursor ?? current.lastCursor;
    if (Array.isArray(payload.events) && payload.events.length) {
      showMyEventsBanner(payload.events);
      await refreshMyEvents({ reset: true, silent: true });
      await refreshMyEventsSummary();
    }
  } catch (_error) {
    // A transient local read error must never stop the event cursor loop.
  }
}
