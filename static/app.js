function installSourceRouter(){
  if(window.__sourceRouterInstalled)return;
  window.__sourceRouterInstalled=true;
  window.__sourceView=window.history.state?.sourceView||window.location.pathname+window.location.search;
  window.history.replaceState({...window.history.state,sourceView:window.__sourceView},"",window.location.href);
  document.addEventListener("click",event=>{
    const link=event.target.closest("a[href]");if(!link)return;
    const target=new URL(link.href,window.location.href);
    if(target.origin!==window.location.origin||!["/","/crown"].includes(target.pathname))return;
    event.preventDefault();window.location.assign(target.pathname+target.search);
  });
}
installSourceRouter();
function installSportsDialogA11y(){
  if(window.__sportsDialogA11y)return;
  window.__sportsDialogA11y=true;
  window.__openSportsDialog=(dialog,opener)=>{
    document.querySelectorAll('[role="dialog"].open').forEach(other=>{
      if(other!==dialog)other.classList.remove("open");
    });
    dialog.__returnFocus=opener||document.activeElement;
    dialog.classList.add("open");
    dialog.setAttribute("aria-hidden","false");
    const target=dialog.querySelector("[data-dialog-autofocus]")||dialog.querySelector("button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]")||dialog;
    requestAnimationFrame(()=>target.focus({preventScroll:true}));
  };
  window.__closeSportsDialog=dialog=>{
    dialog.classList.remove("open");
    dialog.setAttribute("aria-hidden","true");
    const target=dialog.__returnFocus;
    if(target&&target.isConnected)target.focus({preventScroll:true});
  };
  document.addEventListener("keydown",event=>{
    const dialog=[...document.querySelectorAll('[role="dialog"].open')].at(-1);if(!dialog)return;
    if(event.key==="Escape"){event.preventDefault();window.__closeSportsDialog(dialog);return;}
    if(event.key!=="Tab")return;
    const items=[...dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(item=>item.getClientRects().length);
    if(!items.length){event.preventDefault();dialog.focus();return;}
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
  });
}
installSportsDialogA11y();

const crown$=id=>document.getElementById(id);
const crownEmbedded=new URLSearchParams(window.location.search).get("embed")==="1";
const crownCollapsedGroups=new Set();
let crownSelectedId="";
let crownLatestState={events:[],leagues:[],status:"检查中"};
let crownRenderedSignature="";
let crownRenderedAccountsSignature=null;
let crownUpdateInFlight=false;
let crownAccountGeneration=0;
let crownRefreshPaused=false;
let crownLastAccountsFetchAt=0;
const crownExtraAttempts=new Map();
const crownExtraLoading=new Set();
const crownAccountActionsInFlight=new Set();

function crownPostEmbeddedState(){
  if(!crownEmbedded||window.parent===window)return;
  window.parent.postMessage({type:"crown:state",paused:crownRefreshPaused,status:crownLatestState.status||"检查中",cached:Boolean(crownLatestState.cached),error:crownLatestState.error||null,eventCount:Array.isArray(crownLatestState.events)?crownLatestState.events.length:0,updatedAt:crownLatestState.updated_at||null},window.location.origin);
}
function crownSetPaused(paused){
  crownRefreshPaused=Boolean(paused);
  const button=crown$("pauseRefresh");
  if(button){button.setAttribute("aria-pressed",String(crownRefreshPaused));const label=button.querySelector("span");if(label)label.textContent=crownRefreshPaused?"继续刷新":"暂停刷新";}
  const pollState=crown$("crownPollState");if(pollState)pollState.textContent=crownRefreshPaused?"轮询已暂停":"轮询运行中";
  crownPostEmbeddedState();
}

function crownEsc(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function crownLive(event){return !!event.is_live;}
function crownFormatMatchPhase(period,minute,fallback){
  const rawPeriod=String(period??"").trim();
  const rawMinute=String(minute??"").trim();
  const labels={"1H":"上半场","1ST":"上半场","1":"上半场","2H":"下半场","2ND":"下半场","2":"下半场","HT":"中场","HALF_TIME":"中场","HALFTIME":"中场","FT":"已结束","FINISHED":"已结束","FINAL":"已结束","ET":"加时赛","EXTRA_TIME":"加时赛","EXTRATIME":"加时赛","P":"点球","PEN":"点球","PENALTIES":"点球","LIVE":"进行中"};
  const embedded=rawMinute.match(/^([A-Za-z0-9]+)\s*\^\s*(.+)$/);
  if(embedded){const embeddedLabel=labels[String(embedded[1]).toUpperCase()];if(embeddedLabel)return `${embeddedLabel} ${embedded[2].trim()}${["FT","FINISHED","FINAL"].includes(rawPeriod.toUpperCase())?" · 已结束":""}`;}
  const label=labels[rawPeriod.toUpperCase()];
  if(label&&["上半场","下半场","加时赛","进行中"].includes(label)&&rawMinute)return `${label} ${rawMinute}`;
  return label||rawMinute||fallback||"开赛时间未知";
}
function crownNormalizeLine(value){return String(value??"").trim().replace(/\s+/g,"").replace(/[–—−]/g,"-");}
function crownHandicapLine(line,side){
  const text=crownNormalizeLine(line);if(!text)return "盘口未知";
  if(text==="0"||text==="0.0")return "0";
  if(text.startsWith("-"))return side==="home"?text:`+${text.slice(1)}`;
  if(text.startsWith("+"))return side==="home"?text:`-${text.slice(1)}`;
  return side==="home"?`-${text}`:`+${text}`;
}
function crownTimeLabel(value){
  if(!value)return "—";
  const date=new Date(String(value).replace(" ","T"));
  if(Number.isNaN(date.getTime()))return String(value);
  return new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(date);
}
function crownStatusKind(state){
  const status=String(state.status||"");
  if(status==="已连接"&&!state.error)return "live";
  if(/需要重新登录|过期|未连接/.test(status))return "offline";
  if(status==="数据延迟"||status==="缓存数据"||state.cached)return "delayed";
  if(state.error||/不可用|失败/.test(status))return "offline";
  return "loading";
}
function crownLoadedExtra(event){const extra=event&&event.extra_markets;return extra&&extra.status==="loaded"?extra:null;}
function crownMarketItems(event,kind){
  const base=event&&event.markets&&Array.isArray(event.markets[kind])?event.markets[kind]:[];
  const extra=crownLoadedExtra(event);
  const items=extra&&Array.isArray(extra[kind])?extra[kind]:[];
  return items.length?items:base;
}
function crownMoneylineValues(event){
  const extra=crownLoadedExtra(event);
  if(extra&&Array.isArray(extra.moneyline)&&extra.moneyline.length){
    const values=[];
    extra.moneyline.forEach(item=>{
      if(item&&typeof item==="object"){
        if("home" in item||"draw" in item||"away" in item)values.push(item.home,item.draw,item.away);
        else values.push(item.a,item.b);
      }else values.push(item);
    });
    if(values.filter(value=>value!==undefined&&value!==null&&String(value)!=="").length>=3)return values.slice(0,3);
  }
  return Array.isArray(event&&event.markets&&event.markets.moneyline)?event.markets.moneyline:[];
}
function crownQuoteCount(event){
  return crownMarketItems(event,"handicap").length+crownMarketItems(event,"total").length+(crownMoneylineValues(event).length>=3?1:0);
}
function crownMarketStatusText(event,kind,count){
  const extra=event&&event.extra_markets;
  if(extra&&extra.status==="loaded"){
    const baseCount=event&&event.markets&&Array.isArray(event.markets[kind])?event.markets[kind].length:0;
    if(kind==="moneyline"&&Array.isArray(extra.moneyline)&&extra.moneyline.length)return "主盘 + 附加盘";
    if(kind!=="moneyline"&&count>baseCount)return `主盘 + ${count-baseCount} 组附加盘`;
    return `${count} 组盘口`;
  }
  if(extra&&extra.status==="unavailable")return `${count} 组盘口 · 附加盘暂不可用`;
  if(extra&&extra.status==="not_requested")return `${count} 组盘口 · 附加盘加载中`;
  return `${count} 组盘口`;
}
function crownGroupLabel(event){
  if(crownLive(event))return crownFormatMatchPhase(event.period,event.minute,event.start_label);
  return event.start_label||"开赛时间未知";
}
function crownMarketId(item){return item&&(item.gidm||item.market_id||item.gid||item.hgid)||"";}
function crownFilterEvents(events,query,filter){
  return events.filter(event=>{
    if(filter==="live"&&!crownLive(event))return false;
    if(filter==="prematch"&&crownLive(event))return false;
    return !query||[event.league,event.home,event.away,event.id].join(" ").toLowerCase().includes(query);
  });
}
function crownEventItem(event){
  const quoteCount=crownQuoteCount(event);
  const score=event.score||"VS";
  return `<button class="event-item${event.id===crownSelectedId?" selected":""}" type="button" data-event-id="${crownEsc(event.id)}" aria-pressed="${event.id===crownSelectedId}">
    <span class="event-item-main">
      <span class="event-item-top">${crownLive(event)?'<i class="event-live-dot" aria-hidden="true"></i>':""}<span class="event-time">${crownEsc(crownGroupLabel(event))}</span></span>
      <span class="event-team-line"><span>${crownEsc(event.home||"主队")}</span><strong>${crownEsc((score.split("-")[0]||"").trim())}</strong></span>
      <span class="event-team-line"><span>${crownEsc(event.away||"客队")}</span><strong>${crownEsc((score.split("-")[1]||"").trim())}</strong></span>
      <span class="event-item-foot"><span>${crownEsc(event.league||"未命名联赛")}</span><span>${quoteCount} 组报价</span></span>
    </span>
    <span class="event-item-side"><strong>${crownLive(event)?"LIVE":"TODAY"}</strong><span>#${crownEsc(event.id||"—")}</span></span>
  </button>`;
}
function crownEventGroup(key,title,items){
  if(!items.length)return "";
  const leagues=new Map();
  items.forEach(event=>{if(!leagues.has(event.league))leagues.set(event.league,[]);leagues.get(event.league).push(event);});
  const collapsed=crownCollapsedGroups.has(key);
  const leagueHtml=[...leagues.entries()].map(([name,events])=>`<div class="league-label"><strong>${crownEsc(name)}</strong><span>${events.length} 场</span></div>${events.map(crownEventItem).join("")}`).join("");
  return `<section class="event-group ${key}${collapsed?" collapsed":""}"><button class="event-group-head" type="button" data-group-toggle="${key}" aria-expanded="${!collapsed}"><span class="event-group-title">${title}</span><span class="event-group-count">${items.length} 场</span><span class="event-group-toggle" aria-hidden="true">⌄</span></button><div class="league-list">${leagueHtml}</div></section>`;
}
function crownMarketBook(title,items,kind,event){
  const list=Array.isArray(items)?items:[];
  const statusText=crownMarketStatusText(event,kind,list.length);
  if(!list.length)return `<article class="market-book"><header class="market-book-head"><h3>${title}</h3><small>${crownEsc(statusText)}</small></header><div class="market-empty">当前没有有效盘口</div></article>`;
  const rows=list.map(item=>{
    const line=item.raw_line||item.line||"盘口未知";
    const pair=kind==="handicap"
      ? [[`${event.home||"主队"} ${crownHandicapLine(line,"home")}`,item.a],[`${event.away||"客队"} ${crownHandicapLine(line,"away")}`,item.b]]
      : [[`大 ${crownNormalizeLine(line)}`,item.a],[`小 ${crownNormalizeLine(line)}`,item.b]];
    const marketId=crownMarketId(item);
    return `<div class="market-line">${pair.map(([label,price])=>`<div class="selection"><span>${crownEsc(label)}</span><strong>${crownEsc(price||"—")}</strong></div>`).join("")}</div>${marketId?`<div class="market-note">${item.master==="Y"||!item.gidm?"主盘":"附加盘"} · CROWN ${crownEsc(marketId)}</div>`:""}`;
  }).join("");
  return `<article class="market-book"><header class="market-book-head"><h3>${title}</h3><small>${crownEsc(statusText)}</small></header>${rows}</article>`;
}
function crownMoneyline(event){
  const values=crownMoneylineValues(event);
  const statusText=crownMarketStatusText(event,"moneyline",values.length>=3?1:0);
  if(values.length<3)return `<article class="market-book moneyline"><header class="market-book-head"><h3>全场胜平负</h3><small>${crownEsc(statusText)}</small></header><div class="market-empty">当前没有有效报价</div></article>`;
  const labels=[event.home||"主队","和局",event.away||"客队"];
  return `<article class="market-book moneyline"><header class="market-book-head"><h3>全场胜平负</h3><small>${crownEsc(statusText)}</small></header><div class="moneyline-grid">${labels.map((label,index)=>`<div class="moneyline-cell"><span>${crownEsc(label)}</span><strong>${crownEsc(values[index]||"—")}</strong></div>`).join("")}</div></article>`;
}
function crownEventDetail(event){
  if(!event)return `<div class="detail-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg><strong>等待皇冠赛事数据</strong><p>打开皇冠登录并完成会话验证后，赛事和盘口会自动显示在这里。</p><button class="button primary" type="button" data-open-login>连接皇冠会话</button></div>`;
  const markets=event.markets||{};
  const handicapItems=crownMarketItems(event,"handicap");
  const totalItems=crownMarketItems(event,"total");
  const score=event.score||"VS";
  const detail=crownFormatMatchPhase(event.period,event.minute,event.start_label);
  return `<article class="event-hero"><div class="event-hero-top"><div class="event-league"><span>${crownEsc(event.league||"未命名联赛")}</span></div><div class="event-hero-meta"><span class="meta-pill ${crownLive(event)?"live":""}">${crownLive(event)?"滚球":"今日待开"}</span><span class="meta-pill">${crownEsc(event.start_label||"时间未知")}</span><span class="meta-pill">皇冠 ID ${crownEsc(event.id||"—")}</span></div></div><div class="match-hero"><div class="match-team">${crownEsc(event.home||"主队")}</div><div class="match-score"><strong>${crownEsc(score)}</strong><span>${crownEsc(detail)}</span></div><div class="match-team away">${crownEsc(event.away||"客队")}</div></div></article><div class="detail-summary-row"><div><span>报价组数</span><strong>${crownQuoteCount(event)} 组</strong></div><div><span>盘口格式</span><strong>${crownEsc(event.odds_format_label||"皇冠港赔（HK）")}</strong></div><div><span>数据来源</span><strong>当前项目</strong></div></div><div class="markets-layout">${crownMoneyline(event)}${crownMarketBook("让球",handicapItems,"handicap",event)}${crownMarketBook("大小球",totalItems,"total",event)}</div>`;
}
function crownRender(state){
  crownLatestState=state;
  crownPostEmbeddedState();
  const events=Array.isArray(state.events)?state.events:[];
  const query=crown$("crownSearch").value.trim().toLowerCase();
  const filter=crown$("crownFilter").value;
  const visible=crownFilterEvents(events,query,filter);
  if(!visible.some(event=>event.id===crownSelectedId))crownSelectedId=visible[0]?.id||"";
  const selected=visible.find(event=>event.id===crownSelectedId)||null;
  if(selected)crownLoadExtra(selected);
  const liveCount=events.filter(crownLive).length;
  const todayCount=events.length-liveCount;
  const leagueCount=Array.isArray(state.leagues)?state.leagues.length:new Set(events.map(event=>event.league)).size;
  const quoteCount=events.reduce((total,event)=>total+crownQuoteCount(event),0);
  const kind=crownStatusKind(state);
  const status=state.status||"检查中";
  crown$("crownCount").textContent=events.length;
  crown$("crownLiveCount").textContent=`滚球 ${liveCount}`;
  crown$("crownTodayCount").textContent=`今日 ${todayCount}`;
  crown$("crownLeagueCount").textContent=leagueCount;
  crown$("crownVisibleCount").textContent=`显示 ${visible.length}`;
  crown$("crownVisibleBadge").textContent=visible.length;
  crown$("crownStatus").textContent=status;
  crown$("crownDataState").textContent=kind==="live"?"实时更新":state.cached?"缓存数据":kind==="delayed"?"数据延迟":kind==="offline"?"连接异常":"等待数据";
  crown$("crownStateBadge").textContent=kind==="live"?"在线":state.cached?"缓存":kind==="delayed"?"延迟":kind==="offline"?"异常":"检查中";
  crown$("crownStateBadge").className=`micro-badge ${kind==="live"?"live":kind==="offline"?"stale":"delayed"}`;
  crown$("crownConnectionPill").className=`status-pill ${kind==="live"?"live":kind==="offline"?"offline":kind==="delayed"?"delayed":"loading"}`;
  crown$("crownConnectionText").textContent=kind==="live"?"皇冠数据在线":state.cached?"展示最近成功缓存":kind==="delayed"?"上游延迟，保留最近数据":kind==="offline"?(state.error?"数据连接异常":"等待登录"):"正在连接";
  crown$("crownUpdatedAt").textContent=crownTimeLabel(state.updated_at);
  crown$("crownSubStatus").textContent=state.updated_at?`${state.cached?"缓存数据 · 上次更新":"最后更新"} ${crownTimeLabel(state.updated_at)} · 只读轮询`:"等待皇冠会话数据";
  crown$("crownQuoteTotal").textContent=`${quoteCount} 组报价`;
  const errorText={session_conflict:"皇冠提示重复登录。请先在皇冠站点退出其他设备上的会话，再打开登录面板重新登录。",session_expired:"皇冠会话已过期，请打开登录面板重新登录。",session_unverified:"皇冠会话需要重新验证，请打开登录面板完成验证。",upstream_unavailable:"皇冠上游暂时不可用，页面会保留最近数据并自动重试。",upstream_timeout:"皇冠上游响应超时，页面会保留最近数据并按退避间隔重试。",upstream_connection_failed:"无法连接皇冠上游，请检查网络和登录地址。",upstream_http_error:"皇冠上游返回异常状态，页面会自动退避重试。",upstream_response_invalid:"皇冠上游响应格式异常，页面会自动重试。",catalog_incomplete:"皇冠赛事目录暂未完整返回，页面会保留最近数据并重试。",catalog_changed:"皇冠赛事目录发生变化，等待下一次完整同步。"}[state.error]||"皇冠数据暂时不可用，请检查登录会话或稍后重试。";
  crown$("crownErrorText").textContent=state.cached&&state.updated_at?`${errorText} 当前展示 ${crownTimeLabel(state.updated_at)} 的最后成功缓存。`:errorText;
  crown$("crownError").classList.toggle("hidden",kind!=="offline"&&kind!=="delayed");
  const signature=JSON.stringify([visible,state.leagues||[],state.status,state.error,state.cached,state.updated_at,query,filter,selected?.id||"",[...crownCollapsedGroups].sort()]);
  if(signature===crownRenderedSignature)return;
  crownRenderedSignature=signature;
  const live=visible.filter(crownLive);
  const prematch=visible.filter(event=>!crownLive(event));
  const groupHtml=`${crownEventGroup("live","滚球比赛",live)}${crownEventGroup("prematch","今日比赛",prematch)}`;
  crown$("crownEvents").innerHTML=groupHtml||`<div class="event-list-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg><strong>暂无皇冠赛事</strong><p>${query?"没有匹配当前搜索条件的赛事。":"完成皇冠登录后，滚球和今日赛事会自动出现在这里。"}</p>${!query?'<button class="button primary" type="button" data-open-login>连接皇冠会话</button>':""}</div>`;
  crown$("crownEventDetail").innerHTML=crownEventDetail(selected);
}
async function crownLoadExtra(event){
  const gid=String(event&&event.id||"");
  const status=String(event&&event.extra_markets&&event.extra_markets.status||"");
  if(!gid||status==="loaded"||crownExtraLoading.has(gid))return;
  const lastAttempt=Number(crownExtraAttempts.get(gid)||0);
  if(Date.now()-lastAttempt<15000)return;
  crownExtraAttempts.set(gid,Date.now());
  crownExtraLoading.add(gid);
  try{
    const response=await fetch(`/api/crown/events/${encodeURIComponent(gid)}/details`,{method:"POST",cache:"no-store"});
    if(response.ok){crownRenderedSignature="";await crownUpdate(false);}
  }catch(error){
    // The regular polling loop retries after the cooldown.
  }finally{
    crownExtraLoading.delete(gid);
  }
}
function crownSessionView(state){
  const connected=state.status==="已连接";
  const delayed=state.status==="数据延迟"||state.status==="缓存数据"||state.cached;
  crown$("loginIndicator").className=`login-status-indicator ${connected?"connected":state.error?"error":""}`;
  crown$("loginStatusTitle").textContent=connected?"皇冠会话已连接":`皇冠会话${state.status?" · "+state.status:""}`;
  crown$("loginStatusCopy").textContent=connected?`只读赛事接口正常，最近更新：${state.updated_at||"刚刚"}`:delayed?`当前展示上次成功缓存，服务会自动恢复实时连接。最近更新：${state.updated_at||"未知"}`:"请在下面添加账号并完成本项目自己的皇冠登录。";
}
function crownAccountStatus(account){
  const labels={idle:"未登录",logging_in:"登录中",checking:"检查中",awaiting_otp:"等待动态码",awaiting_manual:"等待浏览器操作",session_received:"已保存会话",authenticated:"已验证",expired:"会话已过期",disabled:"已停用"};
  return labels[account.status]||account.status||"未知";
}
function crownRenderAccounts(accounts){
  const root=crown$("crownAccounts");
  if(!accounts.length){root.innerHTML='<div class="account-empty">当前项目还没有添加皇冠账号。</div>';return;}
  root.innerHTML=accounts.map(account=>{
    const session=account.has_session?"已保存会话":"未保存会话";
    const checked=account.last_checked?` · 最后检查 ${crownEsc(account.last_checked)}`:"";
    const otp=account.status==="awaiting_otp"?`<form class="otp-form" data-otp-account="${crownEsc(account.id)}"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="动态验证码" required><button class="action-button primary" type="submit">提交验证码</button></form>`:"";
    return `<div class="account-row" data-account-id="${crownEsc(account.id)}"><div class="account-row-head"><div><div class="account-row-name">${crownEsc(account.username)}</div><div class="account-row-meta">${crownEsc(account.base_url)} · ${session}${checked}</div></div><div class="account-row-status">${crownEsc(crownAccountStatus(account))}</div></div>${otp}<div class="account-row-actions"><button class="action-button" data-account-action="login">登录</button><button class="action-button" data-account-action="check">检查会话</button><button class="action-button" data-account-action="relogin">重新登录</button><button class="action-button" data-account-action="cancel">取消</button><button class="action-button" data-account-action="clear">清除会话</button><button class="action-button danger" data-account-action="delete">删除</button></div></div>`;
  }).join("");
}
function crownApplyAccounts(accounts,forceRender=false){
  const accountList=Array.isArray(accounts)?accounts:[];
  const accountSignature=JSON.stringify(accountList);
  if(forceRender||accountSignature!==crownRenderedAccountsSignature){
    crownRenderedAccountsSignature=accountSignature;
    crownRenderAccounts(accountList);
  }
  return accountList;
}
function crownSetAccountsStatus(message){
  const status=crown$("crownAccountsStatus");
  if(status)status.textContent=message||"";
}
async function crownRefreshAccounts(forceRender=false){
  const generation=crownAccountGeneration;
  const response=await fetch("/api/crown/accounts",{cache:"no-store"});
  if(!response.ok)throw new Error("账号列表刷新失败");
  const payload=await response.json();
  if(generation!==crownAccountGeneration)return false;
  crownLastAccountsFetchAt=Date.now();
  crownApplyAccounts(payload.accounts,forceRender);
  return true;
}
async function crownUpdate(forceAccounts=false){
  if(crownUpdateInFlight)return;
  crownUpdateInFlight=true;
  try{
    const loginDialogOpen=crown$("loginModal").classList.contains("open");
    const accountPollInterval=loginDialogOpen?4000:15000;
    const includeAccounts=forceAccounts||Date.now()-crownLastAccountsFetchAt>=accountPollInterval;
    const accountGeneration=crownAccountGeneration;
    const accountPromise=includeAccounts?fetch("/api/crown/accounts",{cache:"no-store"}).catch(()=>null):null;
    const eventResponse=await fetch("/api/crown/events?compact=1",{cache:"no-store"});
    if(!eventResponse.ok)throw new Error("HTTP error");
    const data=await eventResponse.json();
    crownRender(data);crownSessionView(data);
    if(accountPromise){
      const accountResponse=await accountPromise;
      crownLastAccountsFetchAt=Date.now();
      if(accountResponse&&accountResponse.ok&&accountGeneration===crownAccountGeneration){
        const accounts=await accountResponse.json();
        if(accountGeneration===crownAccountGeneration)crownApplyAccounts(accounts.accounts);
      }
    }
  }catch(error){
    crown$("crownStatus").textContent="读取失败";
    crown$("crownConnectionPill").className="status-pill offline";
    crown$("crownConnectionText").textContent="页面连接失败";
    crown$("crownStateBadge").textContent="失败";
    crown$("crownStateBadge").className="micro-badge stale";
    crown$("crownErrorText").textContent="无法读取皇冠接口，请确认当前项目服务和后端仍然正常运行。";
    crown$("crownError").classList.remove("hidden");
  }finally{crownUpdateInFlight=false;}
}
async function crownCheck(){
  const button=crown$("checkCrownSession");button.disabled=true;button.textContent="检查中…";
  try{await fetch("/api/crown/session/check",{method:"POST",headers:{"Content-Type":"application/json"}});}finally{button.disabled=false;button.textContent="检查全部会话";await Promise.allSettled([crownRefreshAccounts(true),crownUpdate()]);}
}
async function crownAccountAction(id,action){
  if(crownAccountActionsInFlight.has(id))return;
  crownAccountActionsInFlight.add(id);
  const root=crown$("crownAccounts");
  const row=[...root.querySelectorAll("[data-account-id]")].find(item=>item.dataset.accountId===id);
  const button=row&&row.querySelector(`[data-account-action="${action}"]`);
  const rowButtons=row?[...row.querySelectorAll("button")]:[];
  if(row)row.setAttribute("aria-busy","true");
  rowButtons.forEach(item=>{item.disabled=true;});
  if(button)button.textContent="处理中…";
  crownSetAccountsStatus("");
  try{
    const response=await fetch(`/api/crown/accounts/${encodeURIComponent(id)}/${action}`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error||"操作失败");
    crownAccountGeneration+=1;
    if(Array.isArray(payload.accounts))crownApplyAccounts(payload.accounts,true);
    else await crownRefreshAccounts(true);
    const messages={clear:"已清除保存的会话，账号和密码仍保留。",delete:"账号及本地保存的凭据已永久删除。",cancel:"已取消当前登录任务。",check:"会话检查已完成。",login:"登录任务已启动。",relogin:"已清除旧会话并重新启动登录。"};
    crownSetAccountsStatus(messages[action]||"账号操作已完成。");
  }catch(error){
    crownSetAccountsStatus(error.message||"操作失败");
    window.alert(error.message||"操作失败");
  }finally{
    crownAccountActionsInFlight.delete(id);
    if(row?.isConnected){
      row.removeAttribute("aria-busy");
      rowButtons.forEach(item=>{item.disabled=false;});
      if(button)button.textContent={login:"登录",check:"检查会话",relogin:"重新登录",cancel:"取消",clear:"清除会话",delete:"删除"}[action]||"操作";
    }
  }
}
function settingsOpen(){window.__openSportsDialog(crown$("settingsModal"),crown$("settingsButton"));}
function settingsClose(){window.__closeSportsDialog(crown$("settingsModal"));}
function loginOpen(){window.__openSportsDialog(crown$("loginModal"),crown$("joinSessionButton"));crownRefreshAccounts().catch(()=>{});}
crown$("crownAccountForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const status=crown$("crownAccountFormStatus");
  const button=event.currentTarget.querySelector("button[type=submit]");
  button.disabled=true;status.textContent="正在保存并启动登录…";
  const payload={login_url:crown$("crownLoginUrl").value.trim(),username:crown$("crownUsername").value.trim(),password:crown$("crownPassword").value,totp_secret:crown$("crownTotp").value.trim()};
  try{
    const response=await fetch("/api/crown/accounts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"添加账号失败");
    crown$("crownPassword").value="";crown$("crownTotp").value="";status.textContent="账号已保存，登录任务已启动。";
    crownAccountGeneration+=1;
    await Promise.allSettled([crownRefreshAccounts(true),crownUpdate()]);
  }catch(error){status.textContent=error.message||"添加账号失败";}
  finally{button.disabled=false;}
});
crown$("settingsButton").addEventListener("click",settingsOpen);
crown$("settingsClose").addEventListener("click",settingsClose);
crown$("settingsModal").addEventListener("click",event=>{if(event.target===crown$("settingsModal"))settingsClose();});
crown$("crownLoginButton").addEventListener("click",()=>{settingsClose();loginOpen();});
crown$("joinSessionButton").addEventListener("click",loginOpen);
crown$("closeLogin").addEventListener("click",()=>window.__closeSportsDialog(crown$("loginModal")));
crown$("crownEvents").addEventListener("click",event=>{
  const loginButton=event.target.closest("[data-open-login]");if(loginButton){loginOpen();return;}
  const groupButton=event.target.closest("[data-group-toggle]");if(groupButton){const key=groupButton.dataset.groupToggle;if(crownCollapsedGroups.has(key))crownCollapsedGroups.delete(key);else crownCollapsedGroups.add(key);crownRender(crownLatestState);return;}
  const item=event.target.closest("[data-event-id]");if(!item)return;crownSelectedId=item.dataset.eventId;crownRender(crownLatestState);
});
crown$("crownEventDetail").addEventListener("click",event=>{if(event.target.closest("[data-open-login]"))loginOpen();});
crown$("checkCrownSession").addEventListener("click",crownCheck);
crown$("crownAccounts").addEventListener("click",event=>{const button=event.target.closest("[data-account-action]");if(!button)return;const row=button.closest("[data-account-id]");if(!row)return;const action=button.dataset.accountAction;const username=row.querySelector(".account-row-name")?.textContent||"该账号";if(action==="delete"&&!window.confirm(`确认永久删除“${username}”？这会删除本地保存的账号、密码和会话，且无法撤销。`))return;crownAccountAction(row.dataset.accountId,action);});
crown$("crownAccounts").addEventListener("submit",async event=>{
  const form=event.target.closest("[data-otp-account]");if(!form)return;event.preventDefault();
  const button=form.querySelector("button[type=submit]");button.disabled=true;
  try{const response=await fetch(`/api/crown/accounts/${encodeURIComponent(form.dataset.otpAccount)}/otp`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:new FormData(form).get("code")})});const result=await response.json();if(!response.ok)throw new Error(result.error||"验证码提交失败");crownAccountGeneration+=1;await crownRefreshAccounts(true);}catch(error){window.alert(error.message||"验证码提交失败");button.disabled=false;}
});
crown$("crownSearch").addEventListener("input",()=>crownRender(crownLatestState));
crown$("crownFilter").addEventListener("change",()=>crownRender(crownLatestState));
crown$("refreshButton").addEventListener("click",()=>crownUpdate(true));
crown$("pauseRefresh").addEventListener("click",()=>crownSetPaused(!crownRefreshPaused));
if(crownEmbedded){
  window.addEventListener("message",event=>{
    if(event.origin!==window.location.origin||event.source!==window.parent)return;
    const data=event.data||{};if(data.type!=="crown:command")return;
    if(data.command==="refresh")crownUpdate(true);
    else if(data.command==="open-login")loginOpen();
    else if(data.command==="set-paused")crownSetPaused(Boolean(data.paused));
  });
  crownPostEmbeddedState();
}
if(new URLSearchParams(window.location.search).get("openSettings")==="1")settingsOpen();
crownUpdate();
setInterval(()=>{if(!crownRefreshPaused)crownUpdate();},3000);
