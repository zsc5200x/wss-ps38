import { describeSource } from "./source-status.js";
import { fetchJson } from "./http.js";
import { crownPinnacleQuote, crownPinnaclePrice } from "./pinnacle-format.js";

/** Only the fixtures homepage requests and renders confirmed Pinnacle markets. */
export function createConfirmedMarkets({ enabled = false, escapeHtml, onChange = () => {} }) {
  const crownFixtures = enabled;
  const crownEsc = escapeHtml;
  const crownConfirmedById = new Map();
  const crownConfirmedLoading = new Set();
  const crownConfirmedAttempts = new Map();
  function crownConfirmedFor(event){
    if(!crownFixtures)return null;
    const id=String(event&&event.id||"");
    return id?crownConfirmedById.get(id)||null:null;
  }
  function crownConfirmedCrownEvent(event,confirmed){
    const source=confirmed&&((confirmed.crown||confirmed.crownEvent));
    if(!source||typeof source!=="object")return event;
    // Keep the live Crown row (score, minute and current markets) ahead of the
    // persisted mapping snapshot while using the Crown snapshot as a fallback.
    return {...source,...event,markets:event.markets||source.markets||{},extra_markets:event.extra_markets||source.extra_markets||{}};
  }
  function crownPinnacleMarketBook(title,rows,event,marketCode){
    const list=(Array.isArray(rows)?rows:[]).filter(row=>String(row?.market||"")===String(marketCode)&&row?.quoted!==false&&(row?.hongKong!=null||row?.hongKongLabel));
    if(!list.length)return `<article class="market-book market-book-pinnacle"><header class="market-book-head"><h3>${title} · 平博</h3><small>当前没有有效盘口</small></header><div class="market-empty">平博暂无对应报价</div></article>`;
    const lines=list.map(row=>{
      const label=crownPinnacleQuote(row,event);
      const price=crownPinnaclePrice(row);
      return `<div class="pinnacle-quote-row"><div class="pinnacle-quote-label"><strong>${crownEsc(label.label)}</strong><span>${crownEsc(label.line)}</span></div><strong class="pinnacle-price">${crownEsc(price)}</strong></div>`;
    }).join("");
    return `<article class="market-book market-book-pinnacle"><header class="market-book-head"><h3>${title} · 平博</h3><small>${list.length} 条 · HK</small></header><div class="pinnacle-table-head"><span>投注项</span><span>香港盘</span></div>${lines}</article>`;
  }
  function crownConfirmedMarkets(confirmed,event){
    if(!confirmed)return "";
    const pinnacle=confirmed.pinnacle||confirmed.pinnacleEvent||{};
    const rows=Array.isArray(pinnacle.odds)?pinnacle.odds:[];
    const id=String(pinnacle.id||confirmed.pinnacleId||"");
    const freshness=describeSource("平博",confirmed.sources?.pinnacle);
    const header=`<div class="markets-provider-title pinnacle-provider-title"><div><strong>平博对应盘口</strong><span>仅显示已确认关联赛事 · ${crownEsc(freshness.text)}</span></div><small>平博 ID ${crownEsc(id||"—")}</small></div>`;
    if(!rows.length)return `${header}<div class="market-book market-book-pinnacle market-book-pinnacle-empty"><div class="market-empty">已确认平博赛事，但当前还没有采集到对应盘口</div></div>`;
    return `${header}${crownPinnacleMarketBook("胜平负",rows,event,"1")}${crownPinnacleMarketBook("让球",rows,event,"2")}${crownPinnacleMarketBook("大小球",rows,event,"3")}`;
  }
  function crownConfirmedSummary(confirmed,event){
    if(!confirmed)return "";
    const pinnacle=confirmed.pinnacle||confirmed.pinnacleEvent||{};
    const crown=confirmed.crown||confirmed.crownEvent||event||{};
    return `<div class="confirmed-merge-strip"><span class="confirmed-merge-badge">已确认关联</span><div><strong>${crownEsc(crown.league||event?.league||"皇冠联赛")}</strong><span>${crownEsc(crown.home||event?.home||"主队")} vs ${crownEsc(crown.away||event?.away||"客队")}</span></div><small>平博赛事 ${crownEsc(pinnacle.id||confirmed.pinnacleId||"—")}</small></div>`;
  }
  async function crownLoadConfirmed(event,force=false){
    if(!crownFixtures)return;
    const crownId=String(event&&event.id||"");
    if(!crownId||crownConfirmedLoading.has(crownId))return;
    const lastAttempt=Number(crownConfirmedAttempts.get(crownId)||0);
    if(!force&&Date.now()-lastAttempt<5000)return;
    crownConfirmedAttempts.set(crownId,Date.now());
    crownConfirmedLoading.add(crownId);
    try{
      const {response,payload}=await fetchJson(`/api/merge/confirmed?crownId=${encodeURIComponent(crownId)}`,{cache:"no-store"});
      if(!response.ok)return;
      const item=Array.isArray(payload.items)?payload.items.find(entry=>String(entry?.crownId||entry?.crown?.id||entry?.crownEvent?.id||"")===crownId):null;
      if(item)crownConfirmedById.set(crownId,{...item,sources:item.sources||payload.sources});
      else crownConfirmedById.delete(crownId);
      onChange();
    }catch(error){
      // A missing merge record is expected for ordinary unconfirmed Crown events.
    }finally{
      crownConfirmedLoading.delete(crownId);
    }
  }
  return {
    get: crownConfirmedFor,
    mergeEvent: crownConfirmedCrownEvent,
    renderMarkets: (confirmed, event) => enabled ? crownConfirmedMarkets(confirmed, event) : "",
    renderSummary: (confirmed, event) => enabled ? crownConfirmedSummary(confirmed, event) : "",
    load: crownLoadConfirmed,
  };
}
