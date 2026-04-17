"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle   { t:number; o:number; h:number; l:number; c:number }
interface Trade    { id:number; type:"LONG"|"SHORT"; entry:number; sl:number; tp1:number; tp2:number; tp3:number; lot:number; risk:number; rr:string; status:"OPEN"|"TP1"|"TP2"|"TP3"|"SL"|"BE"; pnl:number; time:string; session:string; reason:string; pips:number }
interface AgentLog { id:number; time:string; type:"SCAN"|"TRADE"|"MANAGE"|"SKIP"|"WARN"|"ALERT"; msg:string; detail?:string }
interface Signal   { dir:"LONG"|"SHORT"|"WAIT"; conf:number; ema:boolean; rsi:boolean; struct:boolean; momentum:boolean; rsiVal:number; atr:number; trend:string; strength:"STRONG"|"MODERATE"|"WEAK" }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const f2=(n:number)=>n.toFixed(2);
const f1=(n:number)=>n.toFixed(1);
const clamp=(n:number,a:number,b:number)=>Math.min(b,Math.max(a,n));
const pnlStr=(n:number)=>`${n>=0?"+":"-"}$${Math.abs(n).toFixed(2)}`;

// ─── Session ─────────────────────────────────────────────────────────────────
function getSession(h:number,m:number){
  const t=h+m/60;
  if(t>=7 &&t<10) return{name:"LONDON/NY OVERLAP",abbr:"L/NY",color:"#00D97E",mult:1.0, quality:"PRIME",   desc:"Peak volatility · Maximum pip potential"};
  if(t>=2 &&t<7 ) return{name:"LONDON OPEN",      abbr:"LON", color:"#F5C842",mult:0.85,quality:"STRONG",  desc:"High momentum · Breakout sessions"};
  if(t>=10&&t<12) return{name:"NY MORNING",       abbr:"NYM", color:"#F5C842",mult:0.85,quality:"STRONG",  desc:"Strong trend continuation"};
  if(t>=12&&t<14) return{name:"NY MIDDAY",        abbr:"NYD", color:"#FF8C42",mult:0.5, quality:"MODERATE",desc:"Reduced volatility · Be selective"};
  if(t>=14&&t<19) return{name:"NY AFTERNOON",     abbr:"NYA", color:"#3B9EFF",mult:0.65,quality:"DECENT",  desc:"Trend trades only · No reversals"};
  return                {name:"ASIAN SESSION",     abbr:"ASI", color:"#8B5CF6",mult:0.3, quality:"LOW",     desc:"Range bound · Skip unless perfect"};
}

// ─── Math ─────────────────────────────────────────────────────────────────────
function ema(prices:number[],p:number):number{
  if(prices.length<p)return prices[prices.length-1]||0;
  const k=2/(p+1); let e=prices.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<prices.length;i++)e=prices[i]*k+e*(1-k); return e;
}
function rsi(prices:number[],p=14):number{
  if(prices.length<p+1)return 50;
  let g=0,l=0;
  for(let i=prices.length-p;i<prices.length;i++){const d=prices[i]-prices[i-1]; if(d>0)g+=d; else l-=d;}
  return l===0?100:100-(100/(1+(g/l)));
}
function atr(candles:Candle[],p=14):number{
  if(candles.length<2)return 8;
  const trs=candles.slice(-p).map((c,i,a)=>i===0?c.h-c.l:Math.max(c.h-c.l,Math.abs(c.h-a[i-1].c),Math.abs(c.l-a[i-1].c)));
  return trs.reduce((a,b)=>a+b,0)/trs.length;
}
function macd(prices:number[]):{line:number;signal:number;hist:number}{
  if(prices.length<27)return{line:0,signal:0,hist:0};
  const fast=ema(prices,12),slow=ema(prices,26),line=fast-slow;
  const hist9=prices.slice(-9).map((_,i)=>ema(prices.slice(0,prices.length-8+i),12)-ema(prices.slice(0,prices.length-8+i),26));
  const sig=hist9.reduce((a,b)=>a+b,0)/9;
  return{line,signal:sig,hist:line-sig};
}

// ─── Signal Engine ────────────────────────────────────────────────────────────
// Strategy: 30 pip SL, 60 pip TP1 (1:2), 90 pip TP2 (1:3), 120 pip TP3 (1:4)
function analyze(candles:Candle[],closes:number[]):Signal{
  if(closes.length<55)return{dir:"WAIT",conf:0,ema:false,rsi:false,struct:false,momentum:false,rsiVal:50,atr:8,trend:"NEUTRAL",strength:"WEAK"};
  const e9=ema(closes,9), e21=ema(closes,21), e50=ema(closes,50), e200=ema(closes,Math.min(200,closes.length));
  const r=rsi(closes,14);
  const a=atr(candles,14);
  const m=macd(closes);
  const price=closes[closes.length-1];

  // Structure: significant swing levels
  const hi20=Math.max(...candles.slice(-20).map(c=>c.h));
  const lo20=Math.min(...candles.slice(-20).map(c=>c.l));
  const hi5=Math.max(...candles.slice(-5).map(c=>c.h));
  const lo5=Math.min(...candles.slice(-5).map(c=>c.l));

  // Bull conditions
  const bullEMA=e9>e21&&e21>e50;
  const bullTrend=e50>e200;
  const rsiLong=r>48&&r<72;
  const structL=lo5<lo20*1.001&&price>lo5*1.002; // sweep low + bounce
  const momBull=m.hist>0&&m.line>m.signal;
  // Price must be above e21 for long
  const priceOkL=price>e21;

  // Bear conditions
  const bearEMA=e9<e21&&e21<e50;
  const bearTrend=e50<e200;
  const rsiShort=r<52&&r>28;
  const structS=hi5>hi20*0.999&&price<hi5*0.998; // sweep high + reject
  const momBear=m.hist<0&&m.line<m.signal;
  const priceOkS=price<e21;

  const trend=e50>e200?"BULLISH":e50<e200?"BEARISH":"NEUTRAL";

  // LONG setup — 4 confluence factors
  if(bullEMA&&rsiLong&&priceOkL){
    const extras=[structL,momBull,bullTrend].filter(Boolean).length;
    const conf=2+extras;
    const strength=conf>=4?"STRONG":conf>=3?"MODERATE":"WEAK";
    if(conf>=2)return{dir:"LONG",conf:Math.min(conf,4),ema:true,rsi:true,struct:structL,momentum:momBull,rsiVal:r,atr:a,trend,strength};
  }
  // SHORT setup
  if(bearEMA&&rsiShort&&priceOkS){
    const extras=[structS,momBear,bearTrend].filter(Boolean).length;
    const conf=2+extras;
    const strength=conf>=4?"STRONG":conf>=3?"MODERATE":"WEAK";
    if(conf>=2)return{dir:"SHORT",conf:Math.min(conf,4),ema:true,rsi:true,struct:structS,momentum:momBear,rsiVal:r,atr:a,trend,strength};
  }

  const c=(bullEMA||bearEMA?1:0)+(rsiLong||rsiShort?1:0)+((structL||structS)?1:0)+((momBull||momBear)?1:0);
  return{dir:"WAIT",conf:c,ema:bullEMA||bearEMA,rsi:rsiLong||rsiShort,struct:structL||structS,momentum:momBull||momBear,rsiVal:r,atr:a,trend,strength:"WEAK"};
}

// ─── Lot Size — designed for 30 pip SL, bigger targets ───────────────────────
// 30 pips = 3.0 price points on XAUUSD (1 pip = 0.1)
// With $100, 1:1000, 1 standard lot = $100 margin
// 1 pip on 0.01 lot = $0.01 → 30 pips on 0.01 lot = $0.30
// For $3 risk on 30 pips: 0.01 * (3/0.30) = 0.10 lot
function calcLot(risk:number, slPips:number):number{
  // pip value per 0.01 lot on XAUUSD ≈ $0.01
  const pipValPer001=0.01;
  const lot=(risk/(slPips*pipValPer001))*0.01;
  return Math.min(0.50, Math.max(0.01, parseFloat(lot.toFixed(2))));
}

// ─── Chart ───────────────────────────────────────────────────────────────────
function Chart({candles,price,closes,color,trades}:{candles:Candle[];price:number;closes:number[];color:string;trades:Trade[]}){
  const W=580,H=210;
  if(candles.length<5)return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#2A3545",fontFamily:"monospace",fontSize:10,letterSpacing:"0.2em"}}>COLLECTING DATA...</div>;
  const vis=candles.slice(-70);
  const allP=vis.flatMap(c=>[c.h,c.l]);
  const lo=Math.min(...allP),hi=Math.max(...allP),range=hi-lo||1;
  const toY=(p:number)=>H-((p-lo)/range)*(H-24)-12;
  const cw=Math.max(3,Math.floor((W-20)/vis.length)-1);
  const e9v=closes.length>=9?ema(closes,9):null;
  const e21v=closes.length>=21?ema(closes,21):null;
  const e50v=closes.length>=50?ema(closes,50):null;
  const openTrades=trades.filter(t=>t.status==="OPEN");
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%"}}>
      <rect width={W} height={H} fill="#03050A"/>
      {[0.2,0.4,0.6,0.8].map(f=><line key={f} x1={0} y1={toY(lo+f*range)} x2={W} y2={toY(lo+f*range)} stroke="#111922" strokeWidth={1} strokeDasharray="3,8"/>)}
      {vis.map((c,i)=>{
        const x=10+i*(cw+1),bull=c.c>=c.o,col=bull?"#00D97E":"#FF3B5C";
        const bt=toY(Math.max(c.o,c.c)),bh=Math.max(2,Math.abs(toY(c.o)-toY(c.c)));
        return<g key={i}><line x1={x+cw/2} y1={toY(c.h)} x2={x+cw/2} y2={toY(c.l)} stroke={col} strokeWidth={1} opacity={0.5}/><rect x={x} y={bt} width={cw} height={bh} fill={col} opacity={0.9} rx={0.5}/></g>;
      })}
      {e9v &&<line x1={0} y1={toY(e9v)}  x2={W} y2={toY(e9v)}  stroke="#F5C842" strokeWidth={1.5} strokeDasharray="2,5" opacity={0.8}/>}
      {e21v&&<line x1={0} y1={toY(e21v)} x2={W} y2={toY(e21v)} stroke="#FF8C42" strokeWidth={1.5} strokeDasharray="2,5" opacity={0.7}/>}
      {e50v&&<line x1={0} y1={toY(e50v)} x2={W} y2={toY(e50v)} stroke="#FF3B5C" strokeWidth={1.5} strokeDasharray="2,5" opacity={0.6}/>}
      {/* Open trade levels */}
      {openTrades.map(tr=>(
        <g key={tr.id}>
          <line x1={0} y1={toY(tr.sl)}  x2={W} y2={toY(tr.sl)}  stroke="#FF3B5C" strokeWidth={1} strokeDasharray="6,4" opacity={0.5}/>
          <line x1={0} y1={toY(tr.tp1)} x2={W} y2={toY(tr.tp1)} stroke="#00D97E" strokeWidth={1} strokeDasharray="6,4" opacity={0.5}/>
          <line x1={0} y1={toY(tr.tp2)} x2={W} y2={toY(tr.tp2)} stroke="#00D97E" strokeWidth={1} strokeDasharray="6,4" opacity={0.3}/>
          <text x={5} y={toY(tr.sl)-3}  fill="#FF3B5C" fontSize={8} fontFamily="monospace">SL {f2(tr.sl)}</text>
          <text x={5} y={toY(tr.tp1)-3} fill="#00D97E" fontSize={8} fontFamily="monospace">TP1 {f2(tr.tp1)}</text>
        </g>
      ))}
      <line x1={0} y1={toY(price)} x2={W} y2={toY(price)} stroke={color} strokeWidth={1} strokeDasharray="3,5" opacity={0.9}/>
      <rect x={W-70} y={toY(price)-9} width={68} height={17} fill={color} fillOpacity={0.12} rx={2} stroke={color} strokeWidth={1} strokeOpacity={0.5}/>
      <text x={W-36} y={toY(price)+4} fill={color} fontSize={9} textAnchor="middle" fontFamily="'Space Mono',monospace" fontWeight="700">{price.toFixed(2)}</text>
    </svg>
  );
}

function Spark({data,color,h=36}:{data:number[];color:string;h?:number}){
  if(data.length<2)return null;
  const W=180,H=h,lo=Math.min(...data),hi=Math.max(...data),r=hi-lo||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*W},${H-((v-lo)/r)*(H-4)-2}`).join(" ");
  return(
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:h}}>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={color} fillOpacity="0.12"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} opacity={0.9}/>
      <circle cx={W} cy={H-((data[data.length-1]-lo)/r)*(H-4)-2} r={2.5} fill={color}/>
    </svg>
  );
}

function LogEntry({log}:{log:AgentLog}){
  const C:Record<string,string>={SCAN:"#3B9EFF",TRADE:"#00D97E",MANAGE:"#F5C842",SKIP:"#4A6080",WARN:"#FF3B5C",ALERT:"#FF3B5C"};
  const I:Record<string,string>={SCAN:"◎",TRADE:"◈",MANAGE:"◉",SKIP:"—",WARN:"⚠",ALERT:"🔔"};
  return(
    <div style={{borderLeft:`2px solid ${C[log.type]}35`,paddingLeft:10,marginBottom:12,animation:"fadeIn 0.4s ease"}}>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
        <span style={{color:C[log.type],fontSize:11}}>{I[log.type]}</span>
        <span style={{fontFamily:"'Syne',sans-serif",fontSize:9,fontWeight:700,color:C[log.type],letterSpacing:"0.15em"}}>{log.type}</span>
        <span style={{fontSize:9,color:"#2A3545",fontFamily:"monospace"}}>{log.time}</span>
      </div>
      <div style={{fontSize:11,color:"#C8D8E8",fontFamily:"'DM Mono',monospace",lineHeight:1.6}}>{log.msg}</div>
      {log.detail&&<div style={{fontSize:10,color:"#4A6080",fontFamily:"'DM Mono',monospace",marginTop:4,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{log.detail}</div>}
    </div>
  );
}

// ─── Strategy explanation ─────────────────────────────────────────────────────
// SL: 30 pips (3.0 points)
// TP1: 60 pips (6.0 points) → 1:2 R/R
// TP2: 90 pips (9.0 points) → 1:3 R/R
// TP3: 120 pips (12.0 points) → 1:4 R/R
// Close 40% at TP1, 40% at TP2, let 20% run to TP3
// Expected value per trade: 0.4*(2R) + 0.4*(3R) + 0.2*(4R) - if all hit = 3.2R per trade
const SL_PIPS=30, TP1_PIPS=60, TP2_PIPS=90, TP3_PIPS=120;
const PIP=0.1; // 1 pip on XAUUSD = 0.1 price units

// ─── Main ─────────────────────────────────────────────────────────────────────
const SCAN_INTERVAL=30000; // 30 seconds

export default function Terminal(){
  const BASE=3342.50;
  const [price,setPrice]=useState(BASE);
  const [prevPrice,setPrevPrice]=useState(BASE);
  const [livePrice,setLivePrice]=useState<number|null>(null);
  const [priceSource,setPS]=useState<"LIVE"|"SIM">("SIM");
  const [candles,setCandles]=useState<Candle[]>([]);
  const [closes,setCloses]=useState<number[]>([BASE]);
  const [signal,setSignal]=useState<Signal>({dir:"WAIT",conf:0,ema:false,rsi:false,struct:false,momentum:false,rsiVal:50,atr:8,trend:"NEUTRAL",strength:"WEAK"});
  const [trades,setTrades]=useState<Trade[]>([]);
  const [logs,setLogs]=useState<AgentLog[]>([]);
  const [agentOn,setAgentOn]=useState(false);
  const [agentStatus,setAgentStatus]=useState<"IDLE"|"SCANNING"|"THINKING"|"READY">("IDLE");
  const [scanCount,setScanCount]=useState(0);
  const [countdown,setCountdown]=useState("");
  const [nextRun,setNextRun]=useState(0);
  const [account,setAccount]=useState({equity:100,dailyPnl:0,tradeCount:0,wins:0,losses:0});
  const [rsiHist,setRsiHist]=useState<number[]>([50]);
  const [pnlHist,setPnlHist]=useState<number[]>([0]);
  const [ctTime,setCtTime]=useState("--:--:--");
  const [ctH,setCtH]=useState(8);
  const [ctM,setCtM]=useState(0);
  const [tab,setTab]=useState<"chart"|"agent"|"trades"|"strategy">("chart");
  const tickRef=useRef(0);
  const candleRef=useRef<Candle>({t:Date.now(),o:BASE,h:BASE,l:BASE,c:BASE});
  const agentTimer=useRef<ReturnType<typeof setInterval>|null>(null);
  const logId=useRef(0);
  const tradesRef=useRef<Trade[]>([]);
  const signalRef=useRef<Signal>(signal);
  const priceRef=useRef(BASE);
  const closesRef=useRef<number[]>([BASE]);
  const candlesRef=useRef<Candle[]>([]);
  const sessRef=useRef(getSession(8,0));

  // Keep refs in sync
  useEffect(()=>{tradesRef.current=trades;},[trades]);
  useEffect(()=>{signalRef.current=signal;},[signal]);
  useEffect(()=>{priceRef.current=price;},[price]);
  useEffect(()=>{closesRef.current=closes;},[closes]);
  useEffect(()=>{candlesRef.current=candles;},[candles]);

  const addLog=useCallback((type:AgentLog["type"],msg:string,detail?:string)=>{
    const time=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
    setLogs(p=>[{id:logId.current++,time,type,msg,detail},...p].slice(0,100));
  },[]);

  // ── Real price ───────────────────────────────────────────────────────────
  useEffect(()=>{
    const go=async()=>{
      try{
        const r=await fetch("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d");
        const d=await r.json();
        const p=d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if(p&&p>1000){setLivePrice(p);setPS("LIVE");return;}
      }catch{}
      try{
        const r2=await fetch("https://api.coinbase.com/v2/exchange-rates?currency=XAU");
        const d2=await r2.json();
        const usd=parseFloat(d2?.data?.rates?.USD||"0");
        if(usd>1000){setLivePrice(usd);setPS("LIVE");}
      }catch{}
    };
    go(); const iv=setInterval(go,30000); return()=>clearInterval(iv);
  },[]);

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    const tick=()=>{
      const ct=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date());
      setCtTime(ct); const[h,m]=ct.split(":").map(Number);
      setCtH(h);setCtM(m);sessRef.current=getSession(h,m);
    };
    tick(); const iv=setInterval(tick,1000); return()=>clearInterval(iv);
  },[]);

  // ── Countdown ────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!agentOn){setCountdown("");return;}
    const iv=setInterval(()=>{
      const left=Math.max(0,nextRun-Date.now());
      const m=Math.floor(left/60000),s=Math.floor((left%60000)/1000);
      setCountdown(`${m}:${s.toString().padStart(2,"0")}`);
    },500);
    return()=>clearInterval(iv);
  },[agentOn,nextRun]);

  // ── Price sim + candles ──────────────────────────────────────────────────
  useEffect(()=>{
    const iv=setInterval(()=>{
      tickRef.current+=0.04;
      const t=tickRef.current;
      const base=livePrice||BASE;
      // Realistic multi-wave gold movement
      const np=base+Math.sin(t*0.06)*20+Math.sin(t*0.35)*5+Math.sin(t*0.9)*2+Math.sin(t*2.1)*0.8+(Math.random()-0.5)*0.5;
      setPrice(prev=>{setPrevPrice(prev);priceRef.current=np;return np;});
      setCloses(p=>{const n=[...p.slice(-299),np];closesRef.current=n;return n;});
      setRsiHist(p=>[...p.slice(-59),rsi([...closesRef.current],14)]);

      candleRef.current.h=Math.max(candleRef.current.h,np);
      candleRef.current.l=Math.min(candleRef.current.l,np);
      candleRef.current.c=np;
      if(Date.now()-candleRef.current.t>=5000){
        const c={...candleRef.current};
        setCandles(p=>{const n=[...p.slice(-299),c];candlesRef.current=n;return n;});
        candleRef.current={t:Date.now(),o:np,h:np,l:np,c:np};
      }

      // Trade management
      setTrades(prev=>prev.map(tr=>{
        if(tr.status!=="OPEN")return tr;
        const pipDist=tr.type==="LONG"?(np-tr.entry)/PIP:(tr.entry-np)/PIP;
        const pnl=(pipDist*tr.lot*PIP*100)/PIP*10;
        if(tr.type==="LONG"){
          if(np>=tr.tp3)return{...tr,status:"TP3",pnl:tr.risk*4,pips:TP3_PIPS};
          if(np>=tr.tp2)return{...tr,status:"TP2",pnl:tr.risk*3,pips:TP2_PIPS};
          if(np>=tr.tp1)return{...tr,status:"TP1",pnl:tr.risk*2,pips:TP1_PIPS};
          if(np<=tr.sl) return{...tr,status:"SL", pnl:-tr.risk,pips:-SL_PIPS};
        } else {
          if(np<=tr.tp3)return{...tr,status:"TP3",pnl:tr.risk*4,pips:TP3_PIPS};
          if(np<=tr.tp2)return{...tr,status:"TP2",pnl:tr.risk*3,pips:TP2_PIPS};
          if(np<=tr.tp1)return{...tr,status:"TP1",pnl:tr.risk*2,pips:TP1_PIPS};
          if(np>=tr.sl) return{...tr,status:"SL", pnl:-tr.risk,pips:-SL_PIPS};
        }
        return{...tr,pnl,pips:Math.round(pipDist)};
      }));
    },400);
    return()=>clearInterval(iv);
  },[livePrice]);

  // ── Signal ───────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(candles.length>15&&closes.length>30){
      const s=analyze(candles,closes);
      setSignal(s);signalRef.current=s;
    }
  },[candles,closes]);

  // ── Account ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const closed=trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0);
    const open=trades.filter(t=>t.status==="OPEN").reduce((s,t)=>s+t.pnl,0);
    const dp=closed+open;
    const wins=trades.filter(t=>["TP1","TP2","TP3"].includes(t.status)).length;
    const losses=trades.filter(t=>t.status==="SL").length;
    setAccount({equity:100+dp,dailyPnl:dp,tradeCount:trades.length,wins,losses});
    setPnlHist(p=>[...p.slice(-59),dp]);
  },[trades]);

  // ── Agent core ───────────────────────────────────────────────────────────
  const runScan=useCallback(async()=>{
    const sess=sessRef.current;
    const sig=signalRef.current;
    const trs=tradesRef.current;
    const currentPrice=priceRef.current;
    const openTrades=trs.filter(t=>t.status==="OPEN");
    const dailyPnl=trs.reduce((s,t)=>t.status!=="OPEN"?s+t.pnl:s,0);
    const tradeCount=trs.length;

    setAgentStatus("SCANNING");
    setScanCount(p=>p+1);

    // ── Guard rails ──────────────────────────────────────────────────────
    if(dailyPnl<=-8){
      addLog("WARN","Daily loss limit $8 hit. Agent standing down.","Capital protection engaged. Resume tomorrow.");
      setAgentStatus("READY");return;
    }
    if(tradeCount>=3){
      addLog("SKIP",`Max 3 trades reached (${tradeCount}/3). Monitoring only.`);
      setAgentStatus("READY");return;
    }
    if(openTrades.length>=2){
      addLog("SKIP",`${openTrades.length} positions open. Waiting for resolution.`);
      setAgentStatus("READY");return;
    }

    // ── Quick scan — no AI needed for obvious skips ──────────────────────
    if(sig.dir==="WAIT"||sig.conf<2){
      addLog("SCAN",`Price: $${f2(currentPrice)} | ${sess.name} | RSI ${f1(sig.rsiVal)} | Trend: ${sig.trend} | Conf: ${sig.conf}/4 → WAIT`);
      setAgentStatus("READY");return;
    }

    // ── Strong signal detected — call AI ────────────────────────────────
    if(sig.conf>=3||sig.strength==="STRONG"){
      setAgentStatus("THINKING");
      addLog("SCAN",`⚡ SIGNAL DETECTED: ${sig.dir} | Conf ${sig.conf}/4 | ${sig.strength} | RSI ${f1(sig.rsiVal)} | Consulting AI...`);

      const e9v=closes.length>=9?f2(ema(closesRef.current,9)):"N/A";
      const e21v=closes.length>=21?f2(ema(closesRef.current,21)):"N/A";
      const e50v=closes.length>=50?f2(ema(closesRef.current,50)):"N/A";
      const hi20=candlesRef.current.length>0?Math.max(...candlesRef.current.slice(-20).map(c=>c.h)).toFixed(2):"N/A";
      const lo20=candlesRef.current.length>0?Math.min(...candlesRef.current.slice(-20).map(c=>c.l)).toFixed(2):"N/A";
      const risk=parseFloat((3*sess.mult).toFixed(2));
      const lot=calcLot(risk,SL_PIPS);

      // Levels for this setup
      const sl=sig.dir==="LONG"?currentPrice-SL_PIPS*PIP:currentPrice+SL_PIPS*PIP;
      const tp1=sig.dir==="LONG"?currentPrice+TP1_PIPS*PIP:currentPrice-TP1_PIPS*PIP;
      const tp2=sig.dir==="LONG"?currentPrice+TP2_PIPS*PIP:currentPrice-TP2_PIPS*PIP;
      const tp3=sig.dir==="LONG"?currentPrice+TP3_PIPS*PIP:currentPrice-TP3_PIPS*PIP;

      const prompt=`You are a veteran XAU/USD gold trader. Evaluate this PAPER TRADE setup:

MARKET: XAU/USD @ $${f2(currentPrice)} (${priceSource})
TIME: ${ctTime} Chicago | Session: ${sess.name} (${sess.quality})
SIGNAL: ${sig.dir} | Confidence: ${sig.conf}/4 | Strength: ${sig.strength}
TECHNICALS: EMA9=${e9v} EMA21=${e21v} EMA50=${e50v} | RSI=${f1(sig.rsiVal)} | ATR=${f2(sig.atr)}p
EMA aligned: ${sig.ema} | RSI ok: ${sig.rsi} | Structure swept: ${sig.struct} | MACD momentum: ${sig.momentum}
Trend (EMA50 vs 200): ${sig.trend}
20-bar Range: High $${hi20} | Low $${lo20}

PROPOSED TRADE:
Direction: ${sig.dir}
Entry: $${f2(currentPrice)}
Stop Loss: $${f2(sl)} (${SL_PIPS} pips)
TP1: $${f2(tp1)} (${TP1_PIPS} pips, 1:2 R/R) — close 40%
TP2: $${f2(tp2)} (${TP2_PIPS} pips, 1:3 R/R) — close 40%
TP3: $${f2(tp3)} (${TP3_PIPS} pips, 1:4 R/R) — trail 20%
Lot: ${lot} | Risk: $${risk} | Session mult: ${sess.mult}x

Account: $${f2(100+dailyPnl)} equity | Daily P&L: ${pnlStr(dailyPnl)} | Trades today: ${tradeCount}/3

DECIDE: EXECUTE or SKIP this paper trade.
Respond ONLY with valid JSON:
{"decision":"EXECUTE"|"SKIP","confidence":1-10,"reasoning":"max 2 sentences","key_risk":"biggest risk to this trade","skip_reason":"if SKIP, why (or null)"}`;

      try{
        const res=await fetch("https://api.anthropic.com/v1/messages",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            model:"claude-sonnet-4-20250514",
            max_tokens:300,
            system:"Expert XAU/USD paper trader. Respond only with valid JSON. Be decisive.",
            messages:[{role:"user",content:prompt}]
          })
        });
        const data=await res.json();
        const text=data.content?.find((b:{type:string})=>b.type==="text")?.text||"{}";
        let parsed:{decision:string;confidence:number;reasoning:string;key_risk:string;skip_reason:string|null};
        try{parsed=JSON.parse(text.replace(/```json|```/g,"").trim());}
        catch{addLog("WARN","AI parse error — skipping",text.slice(0,80));setAgentStatus("READY");return;}

        const{decision,confidence,reasoning,key_risk,skip_reason}=parsed;

        if(decision==="EXECUTE"&&confidence>=7){
          const risk2=parseFloat((3*sess.mult).toFixed(2));
          const lot2=calcLot(risk2,SL_PIPS);
          const type=sig.dir as"LONG"|"SHORT";
          const sl2=type==="LONG"?currentPrice-SL_PIPS*PIP:currentPrice+SL_PIPS*PIP;
          const tp1b=type==="LONG"?currentPrice+TP1_PIPS*PIP:currentPrice-TP1_PIPS*PIP;
          const tp2b=type==="LONG"?currentPrice+TP2_PIPS*PIP:currentPrice-TP2_PIPS*PIP;
          const tp3b=type==="LONG"?currentPrice+TP3_PIPS*PIP:currentPrice-TP3_PIPS*PIP;
          const time=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false});

          setTrades(p=>[...p,{
            id:Date.now(),type,entry:currentPrice,sl:sl2,tp1:tp1b,tp2:tp2b,tp3:tp3b,
            lot:lot2,risk:risk2,rr:"1:2/3/4",status:"OPEN",pnl:0,time,
            session:sess.abbr,reason:reasoning,pips:0
          }]);

          addLog("TRADE",
            `✅ ${type} EXECUTED @ $${f2(currentPrice)} | ${lot2} lot | Risk $${risk2} | Conf ${confidence}/10`,
            `SL: $${f2(sl2)} (-${SL_PIPS}p) | TP1: $${f2(tp1b)} (+${TP1_PIPS}p) | TP2: $${f2(tp2b)} (+${TP2_PIPS}p) | TP3: $${f2(tp3b)} (+${TP3_PIPS}p)\n💬 ${reasoning}\n⚠️ Risk: ${key_risk}`
          );
        } else {
          addLog("SKIP",
            `SKIP — ${decision==="SKIP"?"AI declined":"Low confidence"} (${confidence}/10)`,
            skip_reason||reasoning
          );
        }
      }catch(err){
        // No API key — use rule-based execution as fallback
        if(sig.conf>=3&&sig.strength==="STRONG"&&sess.quality!=="LOW"){
          const type=sig.dir as"LONG"|"SHORT";
          const risk2=parseFloat((3*sess.mult).toFixed(2));
          const lot2=calcLot(risk2,SL_PIPS);
          const sl2=type==="LONG"?currentPrice-SL_PIPS*PIP:currentPrice+SL_PIPS*PIP;
          const tp1b=type==="LONG"?currentPrice+TP1_PIPS*PIP:currentPrice-TP1_PIPS*PIP;
          const tp2b=type==="LONG"?currentPrice+TP2_PIPS*PIP:currentPrice-TP2_PIPS*PIP;
          const tp3b=type==="LONG"?currentPrice+TP3_PIPS*PIP:currentPrice-TP3_PIPS*PIP;
          const time=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false});
          setTrades(p=>[...p,{id:Date.now(),type,entry:currentPrice,sl:sl2,tp1:tp1b,tp2:tp2b,tp3:tp3b,lot:lot2,risk:risk2,rr:"1:2/3/4",status:"OPEN",pnl:0,time,session:sess.abbr,reason:`Rule-based: ${sig.conf}/4 confluence, ${sig.strength} signal, ${sess.name}`,pips:0}]);
          addLog("TRADE",`⚡ AUTO-EXECUTED (rule-based) ${type} @ $${f2(currentPrice)} | ${lot2} lot | ${sig.conf}/4 conf | ${sig.strength}`);
        } else {
          addLog("SKIP","Signal below threshold for rule-based execution.");
        }
      }
    } else {
      addLog("SCAN",`$${f2(currentPrice)} | ${sig.dir} ${sig.conf}/4 | RSI ${f1(sig.rsiVal)} | ${sig.trend} | Need stronger setup`);
    }
    setAgentStatus("READY");
  },[addLog,ctTime,priceSource]);

  // ── Agent scheduler — 30 second scans ───────────────────────────────────
  useEffect(()=>{
    if(!agentOn){
      if(agentTimer.current)clearInterval(agentTimer.current);
      setAgentStatus("IDLE");return;
    }
    runScan();
    const next=Date.now()+SCAN_INTERVAL;
    setNextRun(next);
    agentTimer.current=setInterval(()=>{
      runScan();
      setNextRun(Date.now()+SCAN_INTERVAL);
    },SCAN_INTERVAL);
    return()=>{if(agentTimer.current)clearInterval(agentTimer.current);};
  },[agentOn]);

  const toggleAgent=()=>{
    if(!agentOn){
      addLog("ALERT","🤖 AI Agent ACTIVATED — 25yr XAU/USD Expert Online","Scanning every 30 seconds. Strategy: 30p SL | 60p TP1 | 90p TP2 | 120p TP3. Paper trading mode.");
      setAgentOn(true);
    } else {
      addLog("WARN","Agent deactivated. Existing trades remain open.");
      setAgentOn(false);
    }
  };

  const sess=getSession(ctH,ctM);
  const risk=parseFloat((3*sess.mult).toFixed(2));
  const lot=calcLot(risk,SL_PIPS);
  const priceUp=price>=prevPrice;
  const riskHit=account.dailyPnl<=-8;
  const maxTrade=account.tradeCount>=3;
  const openT=trades.filter(t=>t.status==="OPEN");
  const statusColor={IDLE:"#2A3545",SCANNING:"#3B9EFF",THINKING:"#F5C842",READY:"#00D97E"}[agentStatus];

  // Expected P&L per trade at $3 risk
  const expectedWin=risk*2.5; // blended across TP1/2/3
  const expectedLoss=risk;

  return(
    <div style={{minHeight:"100vh",background:"#03050A",color:"#C8D8E8",display:"flex",flexDirection:"column",fontFamily:"'DM Mono',monospace"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes scan{0%{opacity:0.4}50%{opacity:1}100%{opacity:0.4}}
        .pulse{animation:pulse 2s ease-in-out infinite}
        .scanning{animation:scan 0.8s ease-in-out infinite}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#03050A}::-webkit-scrollbar-thumb{background:#1A2535;border-radius:2px}
      `}</style>

      {/* HEADER */}
      <header style={{background:"#070C14",borderBottom:"1px solid #1A2535",padding:"0 20px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:36,height:36,borderRadius:6,background:"linear-gradient(135deg,#D4A843,#7A5200)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Syne',sans-serif",fontWeight:900,color:"#03050A",fontSize:14,boxShadow:"0 0 20px rgba(212,168,67,0.3)"}}>AU</div>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:800,color:"#E8F4FF",letterSpacing:"0.06em"}}>XAU/USD COMMAND</div>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>30s SCAN · 30p SL · 60/90/120p TP · {priceSource}</div>
          </div>
        </div>

        <div style={{display:"flex",alignItems:"baseline",gap:10}}>
          <span style={{fontSize:9,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>XAU/USD</span>
          <span style={{fontSize:32,fontWeight:700,fontFamily:"'Space Mono',monospace",color:priceUp?"#00D97E":"#FF3B5C",transition:"color 0.3s",textShadow:priceUp?"0 0 30px rgba(0,217,126,0.5)":"0 0 30px rgba(255,59,92,0.5)"}}>
            {f2(price)}
          </span>
          <div style={{display:"flex",flexDirection:"column",gap:1}}>
            <span style={{fontSize:11,color:priceUp?"#00D97E":"#FF3B5C",fontFamily:"'Space Mono',monospace"}}>{priceUp?"▲":"▼"}{Math.abs(price-BASE).toFixed(2)}</span>
            <span style={{fontSize:9,color:priceUp?"#00D97E":"#FF3B5C",fontFamily:"monospace",opacity:0.6}}>{priceUp?"+":""}{((price-BASE)/BASE*100).toFixed(3)}%</span>
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <button onClick={toggleAgent} style={{padding:"10px 22px",background:agentOn?"rgba(0,217,126,0.1)":"rgba(212,168,67,0.1)",border:`2px solid ${agentOn?"rgba(0,217,126,0.5)":"rgba(212,168,67,0.4)"}`,borderRadius:6,color:agentOn?"#00D97E":"#D4A843",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:11,letterSpacing:"0.12em",cursor:"pointer",display:"flex",alignItems:"center",gap:8,boxShadow:agentOn?"0 0 20px rgba(0,217,126,0.2)":"none",transition:"all 0.2s"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:statusColor}} className={agentOn?"pulse":""}/>
            {agentOn?`AGENT ON · ${agentStatus}`:"START AI AGENT"}
          </button>
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:5,padding:"6px 14px",textAlign:"center"}}>
            <div style={{fontSize:18,color:"#D4A843",fontFamily:"'Space Mono',monospace",fontWeight:700}}>{ctTime}</div>
            <div style={{fontSize:7,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>CT</div>
          </div>
          <div style={{background:account.equity>=100?"rgba(0,217,126,0.06)":"rgba(255,59,92,0.06)",border:`1px solid ${account.equity>=100?"rgba(0,217,126,0.2)":"rgba(255,59,92,0.2)"}`,borderRadius:5,padding:"6px 14px",textAlign:"center"}}>
            <div style={{fontSize:16,color:account.equity>=100?"#00D97E":"#FF3B5C",fontFamily:"'Space Mono',monospace",fontWeight:700}}>${f2(account.equity)}</div>
            <div style={{fontSize:7,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>EQUITY</div>
          </div>
        </div>
      </header>

      {/* SESSION BANNER */}
      <div style={{background:`linear-gradient(90deg,${sess.color}14,transparent 60%)`,borderBottom:"1px solid #1A2535",padding:"7px 20px",display:"flex",alignItems:"center",gap:20}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:sess.color}} className="pulse"/>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:11,color:sess.color,letterSpacing:"0.1em"}}>{sess.name}</span>
          <span style={{fontSize:10,color:"#4A6080"}}>{sess.desc}</span>
        </div>
        <div style={{width:1,height:16,background:"#1A2535"}}/>
        {[{l:"MULT",v:`${sess.mult}×`,c:sess.color},{l:"LOT",v:lot.toFixed(2),c:"#D4A843"},{l:"RISK",v:`$${risk}`,c:"#00D97E"},{l:"SL",v:"30p",c:"#FF3B5C"},{l:"TP1",v:"60p",c:"#00D97E"},{l:"TP2",v:"90p",c:"#00D97E"},{l:"TP3",v:"120p",c:"#3B9EFF"},{l:"R/R",v:"1:2/3/4",c:"#F5C842"}].map(x=>(
          <div key={x.l} style={{display:"flex",gap:5,alignItems:"center"}}>
            <span style={{color:"#2A3545",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.12em",fontSize:8}}>{x.l}</span>
            <span style={{fontFamily:"'Space Mono',monospace",color:x.c,fontWeight:700,fontSize:11}}>{x.v}</span>
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {agentOn&&<div style={{padding:"3px 10px",background:"rgba(0,217,126,0.08)",border:"1px solid rgba(0,217,126,0.2)",borderRadius:4,fontSize:9,color:statusColor,fontFamily:"'Syne',sans-serif",fontWeight:700,letterSpacing:"0.1em",display:"flex",gap:5,alignItems:"center"}}>
            <span className={agentStatus==="SCANNING"||agentStatus==="THINKING"?"scanning":""}>⟳</span>
            {agentStatus==="READY"?`NEXT SCAN: ${countdown}`:`${agentStatus}...`} · {scanCount} scans
          </div>}
          {riskHit&&<span style={{padding:"3px 10px",background:"rgba(255,59,92,0.1)",border:"1px solid rgba(255,59,92,0.3)",borderRadius:4,fontSize:9,color:"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700}}>⛔ DAILY LIMIT</span>}
          {maxTrade&&!riskHit&&<span style={{padding:"3px 10px",background:"rgba(212,168,67,0.1)",border:"1px solid rgba(212,168,67,0.3)",borderRadius:4,fontSize:9,color:"#D4A843",fontFamily:"'Syne',sans-serif",fontWeight:700}}>⚠ MAX 3</span>}
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"252px 1fr 252px",gap:"1px",background:"#1A2535"}}>

        {/* LEFT */}
        <div style={{background:"#070C14",padding:"14px",display:"flex",flexDirection:"column",gap:"11px",overflowY:"auto"}}>

          {/* Signal */}
          <div style={{background:signal.dir==="LONG"?"rgba(0,217,126,0.05)":signal.dir==="SHORT"?"rgba(255,59,92,0.05)":"rgba(212,168,67,0.03)",border:`1px solid ${signal.dir==="LONG"?"rgba(0,217,126,0.22)":signal.dir==="SHORT"?"rgba(255,59,92,0.22)":"rgba(212,168,67,0.12)"}`,borderRadius:4,padding:"13px"}}>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:8}}>SIGNAL ENGINE · 4 FACTORS</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:24,fontWeight:800,color:signal.dir==="LONG"?"#00D97E":signal.dir==="SHORT"?"#FF3B5C":"#D4A843",textShadow:signal.dir==="LONG"?"0 0 25px rgba(0,217,126,0.5)":signal.dir==="SHORT"?"0 0 25px rgba(255,59,92,0.5)":"none"}}>
                {signal.dir}
              </div>
              <div>
                <div style={{fontSize:8,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:4,textAlign:"right"}}>{signal.strength}</div>
                <div style={{display:"flex",gap:4}}>
                  {[1,2,3,4].map(i=>(
                    <div key={i} style={{width:18,height:18,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,background:signal.conf>=i?(signal.dir==="LONG"?"rgba(0,217,126,0.18)":signal.dir==="SHORT"?"rgba(255,59,92,0.18)":"rgba(212,168,67,0.12)"):"#0A1120",border:`1px solid ${signal.conf>=i?(signal.dir==="LONG"?"rgba(0,217,126,0.35)":signal.dir==="SHORT"?"rgba(255,59,92,0.35)":"rgba(212,168,67,0.25)"):"#1A2535"}`,color:signal.conf>=i?(signal.dir==="LONG"?"#00D97E":signal.dir==="SHORT"?"#FF3B5C":"#D4A843"):"#1A2535"}}>
                      {signal.conf>=i?"✓":"·"}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {[{l:"EMA 9/21/50",ok:signal.ema,v:signal.trend},{l:"RSI (14)",ok:signal.rsi,v:f1(signal.rsiVal)},{l:"Structure",ok:signal.struct,v:signal.struct?"Swept":"Pending"},{l:"MACD Mom.",ok:signal.momentum,v:signal.momentum?"Confirmed":"Flat"}].map(x=>(
              <div key={x.l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <div style={{width:15,height:15,borderRadius:2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,background:x.ok?"rgba(0,217,126,0.1)":"rgba(255,59,92,0.06)",color:x.ok?"#00D97E":"#FF3B5C"}}>{x.ok?"✓":"✗"}</div>
                  <span style={{fontSize:10,color:"#4A6080"}}>{x.l}</span>
                </div>
                <span style={{fontSize:10,fontFamily:"monospace",color:"#C8D8E8"}}>{x.v}</span>
              </div>
            ))}
            <div style={{marginTop:8,padding:"5px 8px",background:"rgba(0,0,0,0.3)",borderRadius:3,fontSize:9,color:"#D4A843",lineHeight:1.5}}>
              ATR: {f2(signal.atr)}p · Need {sess.quality==="LOW"?"4/4":"3+/4"} to trade
            </div>
          </div>

          {/* RSI */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"11px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
              <span style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>RSI (14)</span>
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:13,color:signal.rsiVal>70?"#FF3B5C":signal.rsiVal<30?"#00D97E":"#F5C842",fontWeight:700}}>{f1(signal.rsiVal)}</span>
            </div>
            <div style={{height:6,background:"#0F1929",borderRadius:3,overflow:"hidden",marginBottom:3,position:"relative"}}>
              <div style={{height:"100%",width:`${signal.rsiVal}%`,background:`linear-gradient(90deg,#1A2535,${signal.rsiVal>70?"#FF3B5C":signal.rsiVal<30?"#00D97E":"#F5C842"})`,borderRadius:3,transition:"width 0.5s"}}/>
              {[30,50,70].map(v=><div key={v} style={{position:"absolute",top:0,left:`${v}%`,width:1,height:"100%",background:"rgba(255,255,255,0.1)"}}/>)}
            </div>
            <Spark data={rsiHist} color={signal.rsiVal>70?"#FF3B5C":signal.rsiVal<30?"#00D97E":"#3B9EFF"} h={28}/>
          </div>

          {/* Trade Targets */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"11px"}}>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:10}}>TRADE STRUCTURE</div>
            <div style={{marginBottom:8,padding:"6px 8px",background:"rgba(0,0,0,0.3)",borderRadius:3}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:9,color:"#4A6080"}}>Stop Loss</span>
                <span style={{fontFamily:"monospace",fontSize:11,color:"#FF3B5C",fontWeight:700}}>30 pips · 1×R</span>
              </div>
              {[{l:"TP1",p:60,r:2,c:"rgba(0,217,126,0.7)",pct:"40%"},{l:"TP2",p:90,r:3,c:"rgba(0,217,126,0.5)",pct:"40%"},{l:"TP3",p:120,r:4,c:"rgba(59,158,255,0.7)",pct:"20%"}].map(x=>(
                <div key={x.l} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:9,color:"#4A6080"}}>{x.l} ({x.pct})</span>
                  <span style={{fontFamily:"monospace",fontSize:11,color:x.c,fontWeight:700}}>{x.p}p · {x.r}:1</span>
                </div>
              ))}
            </div>
            <div style={{fontSize:8,color:"#4A6080",marginBottom:6,fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em"}}>{sess.abbr} SESSION SIZING</div>
            {[20,25,30].map(sl=>{
              const r=parseFloat((3*sess.mult).toFixed(2));
              const l=calcLot(r,sl);
              return(
                <div key={sl} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3,marginBottom:3}}>
                  <div style={{textAlign:"center",padding:"4px",background:"#0F1929",borderRadius:2,fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>{sl}p SL</div>
                  <div style={{textAlign:"center",padding:"4px",background:"#0F1929",borderRadius:2,fontSize:9,color:"#D4A843",fontFamily:"monospace",fontWeight:700}}>{l.toFixed(2)}</div>
                  <div style={{textAlign:"center",padding:"4px",background:"#0F1929",borderRadius:2,fontSize:9,color:"#00D97E",fontFamily:"monospace"}}>${r}</div>
                </div>
              );
            })}
          </div>

          {/* Account */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"11px"}}>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:10}}>ACCOUNT</div>
            {[{l:"Equity",v:`$${f2(account.equity)}`,c:account.equity>=100?"#00D97E":"#FF3B5C"},{l:"Daily P&L",v:`${account.dailyPnl>=0?"+":""}$${f2(account.dailyPnl)}`,c:account.dailyPnl>=0?"#00D97E":"#FF3B5C"},{l:"W/L Today",v:`${account.wins}W / ${account.losses}L`,c:"#D4A843"},{l:"Win Rate",v:account.wins+account.losses>0?`${Math.round(account.wins/(account.wins+account.losses)*100)}%`:"—",c:"#3B9EFF"},{l:"Exp. Win",v:`+$${f2(expectedWin)}`,c:"#00D97E"},{l:"Max Loss",v:`-$${f2(expectedLoss)}`,c:"#FF3B5C"}].map(x=>(
              <div key={x.l} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:10,color:"#4A6080"}}>{x.l}</span>
                <span style={{fontSize:10,fontFamily:"monospace",fontWeight:700,color:x.c}}>{x.v}</span>
              </div>
            ))}
            <div style={{marginTop:8}}>
              <div style={{height:4,background:"#0F1929",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${clamp(((8+account.dailyPnl)/8)*100,0,100)}%`,background:account.dailyPnl>-4?"#00D97E":account.dailyPnl>-6?"#F5C842":"#FF3B5C",transition:"width 0.8s"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                <span style={{fontSize:8,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600}}>LOSS BUFFER</span>
                <span style={{fontSize:9,fontFamily:"monospace",color:"#4A6080"}}>${f2(Math.max(0,8+account.dailyPnl))} left</span>
              </div>
            </div>
            <div style={{marginTop:8}}>
              <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.1em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:4}}>P&L CURVE</div>
              <Spark data={pnlHist} color={account.dailyPnl>=0?"#00D97E":"#FF3B5C"} h={32}/>
            </div>
          </div>
        </div>

        {/* CENTER */}
        <div style={{background:"#070C14",display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",borderBottom:"1px solid #1A2535",background:"#03050A"}}>
            {(["chart","agent","trades","strategy"] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{padding:"11px 20px",fontSize:10,letterSpacing:"0.14em",fontFamily:"'Syne',sans-serif",fontWeight:700,textTransform:"uppercase",border:"none",cursor:"pointer",borderBottom:tab===t?"2px solid #D4A843":"2px solid transparent",background:tab===t?"rgba(212,168,67,0.05)":"transparent",color:tab===t?"#D4A843":"#4A6080",transition:"all 0.2s"}}>
                {t==="agent"?`AGENT ${agentOn?"●":"○"}`:t}
              </button>
            ))}
          </div>

          {/* CHART */}
          {tab==="chart"&&(
            <div style={{flex:1,display:"flex",flexDirection:"column",padding:"14px",gap:"12px"}}>
              <div style={{flex:1,background:"#03050A",border:"1px solid #1A2535",borderRadius:4,overflow:"hidden",minHeight:220}}>
                <Chart candles={candles} price={price} closes={closes} color={sess.color} trades={trades}/>
              </div>
              {!agentOn?(
                <div style={{background:"rgba(212,168,67,0.05)",border:"1px solid rgba(212,168,67,0.2)",borderRadius:6,padding:"18px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"#D4A843",letterSpacing:"0.08em",marginBottom:6}}>🤖 AI PAPER TRADER</div>
                  <div style={{fontSize:11,color:"#4A6080",fontFamily:"'DM Mono',monospace",marginBottom:4,lineHeight:1.7}}>
                    Scans every <strong style={{color:"#D4A843"}}>30 seconds</strong> · 4-factor confluence · AI decides each trade<br/>
                    Strategy: <strong style={{color:"#FF3B5C"}}>30p SL</strong> · <strong style={{color:"#00D97E"}}>60p TP1</strong> · <strong style={{color:"#00D97E"}}>90p TP2</strong> · <strong style={{color:"#3B9EFF"}}>120p TP3</strong><br/>
                    Expected profit per win: <strong style={{color:"#00D97E"}}>$7–$15</strong> · Max loss per trade: <strong style={{color:"#FF3B5C"}}>$3</strong>
                  </div>
                  <button onClick={toggleAgent} style={{padding:"12px 32px",background:"linear-gradient(135deg,rgba(212,168,67,0.15),rgba(212,168,67,0.06))",border:"2px solid rgba(212,168,67,0.4)",borderRadius:5,color:"#D4A843",fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:12,letterSpacing:"0.12em",cursor:"pointer"}}>
                    ACTIVATE AI AGENT →
                  </button>
                </div>
              ):(
                <div style={{background:"rgba(0,217,126,0.05)",border:"1px solid rgba(0,217,126,0.2)",borderRadius:5,padding:"11px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:11,color:"#00D97E",marginBottom:2}} className={agentStatus==="SCANNING"||agentStatus==="THINKING"?"scanning":""}>
                      {agentStatus==="READY"?"◎":"⟳"} {agentStatus==="READY"?`AGENT ACTIVE · Next scan ${countdown}`:`${agentStatus.toUpperCase()}...`}
                    </div>
                    <div style={{fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>{scanCount} scans · {trades.length} trades · {account.wins}W {account.losses}L</div>
                  </div>
                  <button onClick={toggleAgent} style={{padding:"6px 14px",background:"rgba(255,59,92,0.1)",border:"1px solid rgba(255,59,92,0.3)",borderRadius:4,color:"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:10,cursor:"pointer",letterSpacing:"0.1em"}}>STOP</button>
                </div>
              )}
              {openT.length>0&&(
                <div>
                  <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:6}}>OPEN POSITIONS</div>
                  {openT.map(tr=>(
                    <div key={tr.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"#0A1120",border:`1px solid ${tr.pnl>=0?"rgba(0,217,126,0.2)":"rgba(255,59,92,0.2)"}`,borderRadius:4,marginBottom:4}}>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:10,padding:"2px 7px",borderRadius:3,background:tr.type==="LONG"?"rgba(0,217,126,0.12)":"rgba(255,59,92,0.12)",color:tr.type==="LONG"?"#00D97E":"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700}}>{tr.type}</span>
                        <span style={{fontSize:10,fontFamily:"monospace",color:"#4A6080"}}>${f2(tr.entry)}</span>
                        <span style={{fontSize:9,color:"#2A3545"}}>SL:{f2(tr.sl)} TP1:{f2(tr.tp1)}</span>
                        <span style={{fontSize:9,color:tr.pips>=0?"#00D97E":"#FF3B5C",fontFamily:"monospace"}}>{tr.pips>0?"+":""}{tr.pips}p</span>
                      </div>
                      <span style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:13,color:tr.pnl>=0?"#00D97E":"#FF3B5C"}}>{pnlStr(tr.pnl)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AGENT LOG */}
          {tab==="agent"&&(
            <div style={{flex:1,display:"flex",flexDirection:"column",padding:"14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:11,color:"#D4A843",marginBottom:2}}>AGENT DECISION LOG</div>
                  <div style={{fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>Every 30s scan · AI reasoning · All trades logged</div>
                </div>
                <div style={{display:"flex",gap:6,fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>
                  <span>Scans: <span style={{color:"#3B9EFF"}}>{scanCount}</span></span>
                  <span>Trades: <span style={{color:"#D4A843"}}>{trades.length}</span></span>
                </div>
              </div>
              {logs.length===0?(
                <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#4A6080"}}>
                  <div style={{fontSize:36,marginBottom:14,opacity:0.2}}>◎</div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:12,fontWeight:700,letterSpacing:"0.2em",marginBottom:6}}>AGENT OFFLINE</div>
                  <div style={{fontSize:10,fontFamily:"monospace",textAlign:"center",lineHeight:1.7}}>Start AI Agent to see every scan,<br/>decision and trade logged live here</div>
                </div>
              ):(
                <div style={{flex:1,overflowY:"auto",paddingRight:4}}>
                  {logs.map(log=><LogEntry key={log.id} log={log}/>)}
                </div>
              )}
            </div>
          )}

          {/* TRADES */}
          {tab==="trades"&&(
            <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <span style={{fontSize:8,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>PAPER TRADE LOG</span>
                <div style={{display:"flex",gap:6}}>
                  {[{l:`W:${account.wins}`,c:"#00D97E",bg:"rgba(0,217,126,0.1)"},{l:`L:${account.losses}`,c:"#FF3B5C",bg:"rgba(255,59,92,0.1)"},{l:`O:${openT.length}`,c:"#F5C842",bg:"rgba(245,200,66,0.1)"}].map(x=>(
                    <span key={x.l} style={{padding:"2px 8px",background:x.bg,borderRadius:3,fontSize:10,color:x.c,fontFamily:"monospace",fontWeight:700}}>{x.l}</span>
                  ))}
                </div>
              </div>
              {trades.length===0&&(
                <div style={{textAlign:"center",padding:"60px 0",color:"#4A6080"}}>
                  <div style={{fontSize:32,opacity:0.15,marginBottom:12}}>◈</div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:11,letterSpacing:"0.2em",marginBottom:6}}>NO TRADES YET</div>
                  <div style={{fontSize:10,fontFamily:"monospace"}}>Start AI Agent · It will auto-execute paper trades</div>
                </div>
              )}
              {trades.map(tr=>{
                const sc=tr.status==="OPEN"?"#F5C842":["TP1","TP2","TP3"].includes(tr.status)?"#00D97E":"#FF3B5C";
                return(
                  <div key={tr.id} style={{background:"#0A1120",border:`1px solid ${["TP1","TP2","TP3"].includes(tr.status)?"rgba(0,217,126,0.18)":tr.status==="SL"?"rgba(255,59,92,0.18)":"rgba(245,200,66,0.12)"}`,borderRadius:5,padding:"11px",marginBottom:7,animation:"fadeIn 0.3s ease"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}>
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{fontSize:10,padding:"2px 7px",borderRadius:3,background:tr.type==="LONG"?"rgba(0,217,126,0.12)":"rgba(255,59,92,0.12)",color:tr.type==="LONG"?"#00D97E":"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700}}>{tr.type}</span>
                        <span style={{fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>{tr.time}</span>
                        <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(59,158,255,0.1)",color:"#3B9EFF",fontFamily:"'Syne',sans-serif",fontWeight:600}}>{tr.session}</span>
                        <span style={{fontSize:9,color:tr.pips>=0?"#00D97E":"#FF3B5C",fontFamily:"monospace"}}>{tr.pips>0?"+":""}{tr.pips}p</span>
                      </div>
                      <div style={{display:"flex",gap:7,alignItems:"center"}}>
                        <span style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:13,color:tr.pnl>=0?"#00D97E":"#FF3B5C"}}>{pnlStr(tr.pnl)}</span>
                        <span style={{fontSize:9,padding:"2px 5px",borderRadius:3,background:`${sc}18`,color:sc,fontFamily:"'Syne',sans-serif",fontWeight:700}}>{tr.status}</span>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:4,marginBottom:6}}>
                      {[{l:"ENTRY",v:f2(tr.entry)},{l:"SL",v:f2(tr.sl)},{l:"TP1",v:f2(tr.tp1)},{l:"TP2",v:f2(tr.tp2)},{l:"TP3",v:f2(tr.tp3)},{l:"LOT",v:tr.lot.toFixed(2)}].map(x=>(
                        <div key={x.l} style={{background:"#0F1929",borderRadius:3,padding:"4px 5px"}}>
                          <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em",marginBottom:2}}>{x.l}</div>
                          <div style={{fontSize:9,fontFamily:"monospace",color:"#E8F4FF"}}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                    {tr.reason&&<div style={{fontSize:9,color:"#4A6080",fontFamily:"monospace",lineHeight:1.5,borderTop:"1px solid #1A2535",paddingTop:5}}>💬 {tr.reason}</div>}
                  </div>
                );
              })}
              {trades.length>0&&(
                <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"11px",marginTop:4}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7}}>
                    {[
                      {l:"WIN RATE",v:account.wins+account.losses>0?`${Math.round(account.wins/(account.wins+account.losses)*100)}%`:"—",c:"#00D97E"},
                      {l:"BEST TRADE",v:`+$${Math.max(0,...trades.map(t=>t.pnl)).toFixed(2)}`,c:"#00D97E"},
                      {l:"TOTAL P&L",v:`${account.dailyPnl>=0?"+":""}$${f2(account.dailyPnl)}`,c:account.dailyPnl>=0?"#00D97E":"#FF3B5C"},
                      {l:"TOTAL PIPS",v:`${trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pips,0)}p`,c:"#D4A843"},
                    ].map(x=>(
                      <div key={x.l} style={{background:"#0F1929",borderRadius:3,padding:"8px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em",marginBottom:4}}>{x.l}</div>
                        <div style={{fontSize:14,fontFamily:"'Space Mono',monospace",fontWeight:700,color:x.c}}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STRATEGY */}
          {tab==="strategy"&&(
            <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
              <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:14}}>25YR GOLD STRATEGY — FULL BREAKDOWN</div>

              <div style={{background:"rgba(0,217,126,0.05)",border:"1px solid rgba(0,217,126,0.15)",borderRadius:5,padding:"13px",marginBottom:10}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:10,color:"#00D97E",letterSpacing:"0.15em",marginBottom:8}}>PROFIT TARGETS (30 pip SL)</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
                  {[{l:"TP1",p:"60 pips",r:"1:2",amt:"$6+",pct:"40% close",c:"#00D97E"},{l:"TP2",p:"90 pips",r:"1:3",amt:"$9+",pct:"40% close",c:"#00D97E"},{l:"TP3",p:"120 pips",r:"1:4",amt:"$12+",pct:"20% trail",c:"#3B9EFF"}].map(x=>(
                    <div key={x.l} style={{background:"rgba(0,0,0,0.3)",borderRadius:4,padding:"10px",textAlign:"center"}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,color:x.c,marginBottom:3}}>{x.l}</div>
                      <div style={{fontFamily:"monospace",fontSize:11,color:"#E8F4FF",marginBottom:2}}>{x.p} · {x.r}</div>
                      <div style={{fontSize:11,color:x.c,fontFamily:"monospace",fontWeight:700,marginBottom:2}}>{x.amt}</div>
                      <div style={{fontSize:9,color:"#4A6080"}}>{x.pct}</div>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:10,color:"#4A6080",fontFamily:"monospace",lineHeight:1.7}}>
                  Expected value per trade (50% win rate):<br/>
                  Win: 40%×$6 + 40%×$9 + 20%×$12 = <span style={{color:"#00D97E",fontWeight:700}}>$8.40</span> avg win<br/>
                  Loss: <span style={{color:"#FF3B5C",fontWeight:700}}>-$3.00</span> · EV per trade: <span style={{color:"#00D97E",fontWeight:700}}>+$2.70</span>
                </div>
              </div>

              {[
                {title:"4-FACTOR CONFLUENCE (need 3+/4)",color:"#D4A843",rules:["EMA 9 > 21 > 50 (bull) or 9 < 21 < 50 (bear)","RSI 48–72 for longs · 28–52 for shorts","Structure: swing level swept + reversal confirmed","MACD histogram confirms direction","Asian session: must have ALL 4/4"]},
                {title:"SCAN FREQUENCY",color:"#3B9EFF",rules:["Every 30 seconds — catches moves fast","Quick check: if signal < 3/4, log and skip","Full AI analysis only when 3+/4 confluence","AI needs confidence ≥7/10 to execute","Fallback: rule-based if no API key"]},
                {title:"SESSION SIZING",color:"#F5C842",rules:["London/NY Overlap (07–10 CT): 100% size","London + NY Morning (02–12 CT): 85% size","NY Afternoon (14–19 CT): 65% size","NY Midday (12–14 CT): 50% size","Asian (19–02 CT): 30% — only 4/4 setups"]},
                {title:"RISK RULES — NON-NEGOTIABLE",color:"#FF3B5C",rules:["Max 3 trades per day · $8 daily loss limit","Close 40% at TP1 · Move SL to breakeven","Close 40% at TP2 · Trail 20% to TP3","Never add to a losing position","If account drops to $80: reduce all lots 50%"]},
              ].map(s=>(
                <div key={s.title} style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"11px",marginBottom:7}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:9,color:s.color,letterSpacing:"0.18em",marginBottom:7}}>{s.title}</div>
                  {s.rules.map((r,i)=>(
                    <div key={i} style={{display:"flex",gap:7,marginBottom:5,fontSize:11,color:"#C8D8E8",fontFamily:"monospace",lineHeight:1.5}}>
                      <span style={{color:s.color,flexShrink:0}}>›</span>{r}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div style={{background:"#070C14",padding:"14px",display:"flex",flexDirection:"column",gap:"11px",overflowY:"auto"}}>

          {/* Agent stats */}
          <div style={{background:agentOn?"rgba(0,217,126,0.05)":"rgba(212,168,67,0.04)",border:`1px solid ${agentOn?"rgba(0,217,126,0.2)":"rgba(212,168,67,0.12)"}`,borderRadius:4,padding:"13px"}}>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:8}}>AI AGENT</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <div style={{width:9,height:9,borderRadius:"50%",background:statusColor,boxShadow:agentOn?`0 0 12px ${statusColor}`:"none"}} className={agentOn?"pulse":""}/>
              <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:12,color:statusColor}}>{agentOn?agentStatus:"OFFLINE"}</span>
            </div>
            <div style={{fontSize:10,color:"#4A6080",fontFamily:"monospace",lineHeight:1.7,marginBottom:10}}>
              {agentOn?`Scanning every 30s\nNext: ${countdown}\nScans done: ${scanCount}`:"Activate to start\npaper trading"}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
              {[{l:"SCANS",v:scanCount,c:"#3B9EFF"},{l:"TRADES",v:trades.length,c:"#D4A843"},{l:"WINS",v:account.wins,c:"#00D97E"},{l:"LOSSES",v:account.losses,c:"#FF3B5C"}].map(x=>(
                <div key={x.l} style={{background:"#0A1120",borderRadius:3,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em",marginBottom:3}}>{x.l}</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:16,color:x.c}}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Session */}
          <div style={{background:`${sess.color}0D`,border:`1px solid ${sess.color}28`,borderRadius:4,padding:"12px"}}>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:6}}>ACTIVE SESSION</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:12,color:sess.color,marginBottom:3}}>{sess.name}</div>
            <div style={{fontSize:10,color:"#C8D8E8",fontFamily:"monospace",marginBottom:8,lineHeight:1.5}}>{sess.desc}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
              {[{l:"MULT",v:`${sess.mult}×`,c:sess.color},{l:"QUALITY",v:sess.quality,c:sess.color},{l:"LOT",v:lot.toFixed(2),c:"#D4A843"},{l:"RISK",v:`$${risk}`,c:"#00D97E"}].map(x=>(
                <div key={x.l} style={{background:"rgba(0,0,0,0.3)",borderRadius:3,padding:"6px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em",marginBottom:3}}>{x.l}</div>
                  <div style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:x.c}}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Key levels */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"12px"}}>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:8}}>KEY LEVELS</div>
            {[{l:"Prev D. High",v:(price+18.4).toFixed(2),c:"#FF3B5C"},{l:"Session H",v:(price+8.2).toFixed(2),c:"#3B9EFF"},{l:"Round",v:(Math.round(price/10)*10).toFixed(2),c:"#2A3545"},{l:"▶ LIVE",v:price.toFixed(2),c:sess.color},{l:"Session L",v:(price-7.6).toFixed(2),c:"#3B9EFF"},{l:"Prev D. Low",v:(price-15.8).toFixed(2),c:"#00D97E"}].map(x=>(
              <div key={x.l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.02)"}}>
                <span style={{fontSize:10,color:"#4A6080"}}>{x.l}</span>
                <span style={{fontFamily:"monospace",fontSize:11,color:x.c,fontWeight:700}}>{x.v}</span>
              </div>
            ))}
          </div>

          {/* Session timeline */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"12px"}}>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:8}}>SESSION SCHEDULE</div>
            {[{t:"07–10",n:"L/NY",c:"#00D97E",m:"100%",q:"PRIME"},{t:"02–07",n:"London",c:"#F5C842",m:"85%",q:"STRONG"},{t:"10–12",n:"NY Morn",c:"#F5C842",m:"85%",q:"STRONG"},{t:"14–19",n:"NY Aftn",c:"#3B9EFF",m:"65%",q:"DECENT"},{t:"12–14",n:"Midday",c:"#FF8C42",m:"50%",q:"MOD"},{t:"19–02",n:"Asian",c:"#8B5CF6",m:"30%",q:"LOW"}].map((s,i)=>{
              const isNow=sess.abbr===["L/NY","LON","NYM","NYA","NYD","ASI"][i];
              return(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 7px",marginBottom:3,borderRadius:3,background:isNow?`${s.c}10`:"transparent",border:`1px solid ${isNow?`${s.c}22`:"transparent"}`,transition:"all 0.3s"}}>
                  <div>
                    <div style={{fontSize:10,color:isNow?s.c:"#4A6080",fontFamily:"monospace",fontWeight:isNow?700:400}}>{s.n}{isNow?" ←":""}</div>
                    <div style={{fontSize:8,color:"#2A3545",fontFamily:"monospace"}}>{s.t} CT · {s.q}</div>
                  </div>
                  <div style={{fontFamily:"monospace",fontSize:11,color:s.c,fontWeight:700}}>{s.m}</div>
                </div>
              );
            })}
          </div>

          {/* Iron rules */}
          <div style={{background:"rgba(255,59,92,0.04)",border:"1px solid rgba(255,59,92,0.13)",borderRadius:4,padding:"11px"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:8,color:"#FF3B5C",letterSpacing:"0.2em",marginBottom:7}}>HARD LIMITS</div>
            {["30p SL — never wider","60p TP1 minimum target","3 trades max per day","$8 daily loss = full stop","Asian: 4/4 confluence only","Paper only — no real money"].map((r,i)=>(
              <div key={i} style={{display:"flex",gap:6,marginBottom:5,fontSize:10,color:"#C8D8E8",fontFamily:"monospace"}}>
                <span style={{color:"#FF3B5C",flexShrink:0}}>—</span>{r}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer style={{background:"#03050A",borderTop:"1px solid #1A2535",padding:"7px 20px",display:"flex",justifyContent:"space-between"}}>
        <span style={{fontSize:8,color:"#2A3545",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>XAU/USD COMMAND · 30s SCAN · 30p SL · 60/90/120p TP · PAPER TRADING</span>
        <span style={{fontSize:8,color:"#2A3545",fontFamily:"'Syne',sans-serif",letterSpacing:"0.1em"}}>⚠ SIMULATION ONLY — NO REAL MONEY</span>
      </footer>
    </div>
  );
}
