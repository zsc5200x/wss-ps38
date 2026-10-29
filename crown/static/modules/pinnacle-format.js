export function crownFormatPinnacleLine(value){
  const number=Number(value);
  if(!Number.isFinite(number))return String(value??"—");
  const rounded=number.toFixed(2).replace(/\.?0+$/,"" );
  return rounded==="-0"?"0":rounded;
}
export function crownFormatPinnacleHandicap(value){
  const number=Number(value);
  if(!Number.isFinite(number))return crownFormatPinnacleLine(value);
  if(Math.abs(number)<0.000001)return "0";
  return `${number>0?"+":""}${crownFormatPinnacleLine(number)}`;
}
export function crownFormatPinnacleTotal(value){
  const number=Number(value);
  if(!Number.isFinite(number))return crownFormatPinnacleLine(value);
  const steps=Math.round(number*4);
  if(Math.abs(number*4-steps)<0.000001&&Math.abs(steps)%2===1){
    return `${crownFormatPinnacleLine(number-0.25)}/${crownFormatPinnacleLine(number+0.25)}`;
  }
  return crownFormatPinnacleLine(number);
}
export function crownPinnacleTeams(event){
  const home=String(event?.home||"").trim();
  const away=String(event?.away||"").trim();
  if(home||away)return [home||"主队",away||"客队"];
  const parts=String(event?.name||"").split(/\s+VS\s+/i);
  return [parts[0]||"主队",parts[1]||"客队"];
}
export function crownPinnacleQuote(row,event){
  const [home,away]=crownPinnacleTeams(event);
  const market=String(row?.market||"");
  const option=String(row?.option||"");
  if(market==="1")return {label:{"0":`${home} 主胜`,"1":"和局","2":`${away} 客胜`}[option]||`选项 ${option}`,line:"全场"};
  if(market==="2"){
    const raw=Number(row?.line);
    const side=option==="0"?raw:-raw;
    const role=!Number.isFinite(side)||Math.abs(side)<0.000001?"平手":side<0?"让球":"受让";
    return {label:`${option==="0"?home:away} ${crownFormatPinnacleHandicap(side)}`,line:role};
  }
  if(market==="3"){
    const line=crownFormatPinnacleTotal(row?.line);
    return {label:`${option==="3"?"大":"小"}${line}`,line:"总进球"};
  }
  return {label:`选项 ${option||"—"}`,line:`盘口 ${market||"—"}`};
}
export function crownPinnaclePrice(row){
  if(!row||row.quoted===false)return "—";
  const hk=row.hongKongLabel??(row.hongKong==null?"":Number(row.hongKong).toFixed(3));
  return String(hk||"—");
}
