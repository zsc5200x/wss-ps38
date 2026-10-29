import { numberFormatter } from "../constants.js";
import { dom } from "../dom.js";
import { el, setText } from "../shared/dom.js";
import { leagueDisplayName, formatClock, formatShortDate, formatKickoff, matchClockLabel, quoteAgeInfo, qualityLabel, teamNames, formatKickoffParts, periodLabel } from "../shared/format.js";
import { state } from "../state.js";

export function eventMatches(event) {
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

export const leagueCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function scopeRank(event) {
  return event.scope === "live" ? 0 : 1;
}

export function sortedEvents(events) {
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

export function groupEventsByLeague(events) {
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

export function createEventItem(event) {
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

export function updateEventItem(button, event) {
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

export function createLeagueGroup(group) {
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

export function createScopeSection(scope, groups) {
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

export function renderEvents(force = false) {
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

export function renderSelected() {
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
  const age = quoteAgeInfo(updatedAt, state.snapshot?.serverTime);

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
