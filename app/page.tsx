"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle   { t:number; o:number; h:number; l:number; c:number }
interface Trade    { id:number; type:"LONG"|"SHORT"; entry:number; sl:number; tp1:number; tp2:number; lot:number; risk:number; status:"OPEN"|"TP1"|"TP2"|"SL"|"BE"; pnl:number; time:string; session:string; reason:string }
interface AgentLog { id:number; time:string; type:"THINK"|"TRADE"|"MANAGE"|"SKIP"|"WARN"; message:string; detail?:string }
interface Signal   { dir:"LONG"|"SHORT"|"WAIT"; conf:number; ema:boolean; rsi:boolean; struct:boolean; rsiVal:number; atr:number; trend:string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
const f2 = (n:number) => n.toFixed(2);
const f1 = (n:number) => n.toFixed(1);
const pnlStr = (n:number) => `${n>=0?"+":""}$${Math.abs(n).toFixed(2)}`;
const clamp = (n:number,a:number,b:number) => Math.min(b,Math.max(a,n));

// ─── Session ──────────────────────────────────────────────────────────────────
function getSession(h:number, m:number) {
  const t = h + m/60;
  if (t>=7  && t<10) return { name:"LONDON/NY OVERLAP", abbr:"L/NY", color:"#00D97E", mult:1.0,  quality:"PRIME",   desc:"Peak liquidity — best setups" };
  if (t>=2  && t<7 ) return { name:"LONDON OPEN",       abbr:"LON",  color:"#F5C842", mult:0.8,  quality:"GOOD",    desc:"High volatility — breakouts" };
  if (t>=10 && t<12) return { name:"NY MORNING",        abbr:"NYM",  color:"#F5C842", mult:0.8,  quality:"GOOD",    desc:"Momentum — trend continuation" };
  if (t>=12 && t<14) return { name:"NY MIDDAY",         abbr:"NYD",  color:"#FF8C42", mult:0.4,  quality:"WEAK",    desc:"Choppy — scalps only" };
  if (t>=14 && t<19) return { name:"NY AFTERNOON",      abbr:"NYA",  color:"#3B9EFF", mult:0.6,  quality:"DECENT",  desc:"Moderate — trend trades" };
  return                    { name:"ASIAN SESSION",      abbr:"ASI",  color:"#8B5CF6", mult:0.25, quality:"MINIMAL", desc:"Range-bound — wait for London" };
}

// ─── Market Math ──────────────────────────────────────────────────────────────
function calcEMA(prices:number[], period:number):number {
  if (prices.length < period) return prices[prices.length-1]||0;
  const k = 2/(period+1);
  let ema = prices.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for (let i=period; i<prices.length; i++) ema = prices[i]*k + ema*(1-k);
  return ema;
}

function calcRSI(prices:number[], period=14):number {
  if (prices.length < period+1) return 50;
  let gains=0, losses=0;
  for (let i=prices.length-period; i<prices.length; i++) {
    const diff = prices[i]-prices[i-1];
    if (diff>0) gains+=diff; else losses-=diff;
  }
  const rs = losses===0 ? 100 : gains/losses;
  return 100-(100/(1+rs));
}

function calcATR(candles:Candle[], period=14):number {
  if (candles.length < 2) return 5;
  const trs = candles.slice(-period).map((c,i,arr) => {
    if (i===0) return c.h-c.l;
    return Math.max(c.h-c.l, Math.abs(c.h-arr[i-1].c), Math.abs(c.l-arr[i-1].c));
  });
  return trs.reduce((a,b)=>a+b,0)/trs.length;
}

function analyzeMarket(candles:Candle[], closes:number[]):Signal {
  if (closes.length < 55) return { dir:"WAIT", conf:0, ema:false, rsi:false, struct:false, rsiVal:50, atr:5, trend:"NEUTRAL" };
  const ema9  = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const rsi   = calcRSI(closes, 14);
  const atr   = calcATR(candles, 14);
  const price = closes[closes.length-1];

  // Structure: recent swing sweep
  const last20h = Math.max(...candles.slice(-20).map(c=>c.h));
  const last20l = Math.min(...candles.slice(-20).map(c=>c.l));
  const nearHigh = Math.abs(price-last20h) < atr*0.3;
  const nearLow  = Math.abs(price-last20l) < atr*0.3;

  const bullEMA  = ema9>ema21 && ema21>ema50;
  const bearEMA  = ema9<ema21 && ema21<ema50;
  const rsiLong  = rsi>50 && rsi<72;
  const rsiShort = rsi<50 && rsi>28;
  const structL  = nearLow  && closes[closes.length-1]>closes[closes.length-3]; // sweep low + reversal
  const structS  = nearHigh && closes[closes.length-1]<closes[closes.length-3];

  const trend = ema9>ema50 ? "BULLISH" : ema9<ema50 ? "BEARISH" : "NEUTRAL";

  if (bullEMA && rsiLong && structL)  return { dir:"LONG",  conf:3, ema:true,  rsi:true,  struct:true,  rsiVal:rsi, atr, trend };
  if (bearEMA && rsiShort && structS) return { dir:"SHORT", conf:3, ema:true,  rsi:true,  struct:true,  rsiVal:rsi, atr, trend };
  if (bullEMA && rsiLong)             return { dir:"LONG",  conf:2, ema:true,  rsi:true,  struct:false, rsiVal:rsi, atr, trend };
  if (bearEMA && rsiShort)            return { dir:"SHORT", conf:2, ema:true,  rsi:true,  struct:false, rsiVal:rsi, atr, trend };
  if (bullEMA)                        return { dir:"LONG",  conf:1, ema:true,  rsi:false, struct:false, rsiVal:rsi, atr, trend };
  if (bearEMA)                        return { dir:"SHORT", conf:1, ema:true,  rsi:false, struct:false, rsiVal:rsi, atr, trend };
  const c = (bullEMA||bearEMA?1:0)+(rsiLong||rsiShort?1:0)+((structL||structS)?1:0);
  return { dir:"WAIT", conf:c, ema:bullEMA||bearEMA, rsi:rsiLong||rsiShort, struct:structL||structS, rsiVal:rsi, atr, trend };
}

// ─── Candle Chart ─────────────────────────────────────────────────────────────
function CandleChart({ candles, price, closes, color }:{ candles:Candle[]; price:number; closes:number[]; color:string }) {
  const W=580, H=200;
  if (candles.length<5) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#4A6080",fontFamily:"'Space Mono',monospace",fontSize:10,letterSpacing:"0.2em"}}>COLLECTING DATA...</div>;
  const visible = candles.slice(-70);
  const prices = visible.flatMap(c=>[c.h,c.l]);
  const lo=Math.min(...prices), hi=Math.max(...prices), range=hi-lo||1;
  const toY=(p:number)=>H-((p-lo)/range)*(H-24)-12;
  const cw=Math.max(3,Math.floor((W-20)/visible.length)-1);
  // EMAs
  const e9=closes.length>=9?calcEMA(closes,9):null;
  const e21=closes.length>=21?calcEMA(closes,21):null;
  const e50=closes.length>=50?calcEMA(closes,50):null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%"}}>
      <defs>
        <linearGradient id="chartBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#070C14"/>
          <stop offset="100%" stopColor="#03050A"/>
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#chartBg)"/>
      {[0.2,0.4,0.6,0.8].map(f=>(
        <g key={f}>
          <line x1={0} y1={toY(lo+f*range)} x2={W} y2={toY(lo+f*range)} stroke="#1A2535" strokeWidth={1} strokeDasharray="4,8"/>
          <text x={W-4} y={toY(lo+f*range)+3} fill="#2A3545" fontSize={7} textAnchor="end" fontFamily="monospace">{(lo+f*range).toFixed(1)}</text>
        </g>
      ))}
      {visible.map((c,i)=>{
        const x=10+i*(cw+1), bull=c.c>=c.o, col=bull?"#00D97E":"#FF3B5C";
        const bt=toY(Math.max(c.o,c.c)), bh=Math.max(2,Math.abs(toY(c.o)-toY(c.c)));
        return <g key={i}><line x1={x+cw/2} y1={toY(c.h)} x2={x+cw/2} y2={toY(c.l)} stroke={col} strokeWidth={1} opacity={0.5}/><rect x={x} y={bt} width={cw} height={bh} fill={col} opacity={0.85} rx={0.5}/></g>;
      })}
      {e9  && <line x1={0} y1={toY(e9)}  x2={W} y2={toY(e9)}  stroke="#F5C842" strokeWidth={1} strokeDasharray="2,4" opacity={0.8}/>}
      {e21 && <line x1={0} y1={toY(e21)} x2={W} y2={toY(e21)} stroke="#FF8C42" strokeWidth={1} strokeDasharray="2,4" opacity={0.7}/>}
      {e50 && <line x1={0} y1={toY(e50)} x2={W} y2={toY(e50)} stroke="#FF3B5C" strokeWidth={1} strokeDasharray="2,4" opacity={0.6}/>}
      <line x1={0} y1={toY(price)} x2={W} y2={toY(price)} stroke={color} strokeWidth={1} strokeDasharray="3,5" opacity={0.9}/>
      <rect x={W-68} y={toY(price)-9} width={66} height={17} fill={color} fillOpacity={0.15} rx={2} stroke={color} strokeWidth={1} strokeOpacity={0.6}/>
      <text x={W-35} y={toY(price)+4} fill={color} fontSize={9} textAnchor="middle" fontFamily="'Space Mono',monospace" fontWeight="700">{price.toFixed(2)}</text>
    </svg>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Spark({ data, color, h=36 }:{ data:number[]; color:string; h?:number }) {
  if (data.length<2) return null;
  const W=180, H=h, lo=Math.min(...data), hi=Math.max(...data), r=hi-lo||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*W},${H-((v-lo)/r)*(H-4)-2}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:h}}>
      <defs><linearGradient id={`sp${color.replace(/[^a-z0-9]/gi,"")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#sp${color.replace(/[^a-z0-9]/gi,"")})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} opacity={0.9}/>
      <circle cx={(data.length-1)/(data.length-1)*W} cy={H-((data[data.length-1]-lo)/r)*(H-4)-2} r={2.5} fill={color}/>
    </svg>
  );
}

// ─── RSI Bar ──────────────────────────────────────────────────────────────────
function RsiBar({ value }:{ value:number }) {
  const col = value>70?"#FF3B5C":value<30?"#00D97E":"#F5C842";
  const pct = (value/100)*100;
  return (
    <div style={{position:"relative"}}>
      <div style={{height:8,background:"#0F1929",borderRadius:4,overflow:"hidden",marginBottom:3}}>
        <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,#1A2535,${col})`,borderRadius:4,transition:"width 0.5s"}}/>
        {/* Zone markers */}
        <div style={{position:"absolute",top:0,left:"30%",width:1,height:"100%",background:"rgba(0,217,126,0.4)"}}/>
        <div style={{position:"absolute",top:0,left:"50%",width:1,height:"100%",background:"rgba(212,168,67,0.4)"}}/>
        <div style={{position:"absolute",top:0,left:"70%",width:1,height:"100%",background:"rgba(255,59,92,0.4)"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#4A6080",fontFamily:"monospace"}}>
        <span style={{color:"#00D97E"}}>30</span><span style={{color:"#F5C842"}}>50</span><span style={{color:"#FF3B5C"}}>70</span>
      </div>
    </div>
  );
}

// ─── Agent Log Entry ──────────────────────────────────────────────────────────
function LogEntry({ log }:{ log:AgentLog }) {
  const colors:Record<string,string> = { THINK:"#3B9EFF", TRADE:"#00D97E", MANAGE:"#F5C842", SKIP:"#4A6080", WARN:"#FF3B5C" };
  const icons:Record<string,string>  = { THINK:"◎", TRADE:"◈", MANAGE:"◉", SKIP:"◌", WARN:"⚠" };
  return (
    <div style={{borderLeft:`2px solid ${colors[log.type]}40`,paddingLeft:10,marginBottom:10,animation:"fadeIn 0.4s ease-out"}}>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
        <span style={{color:colors[log.type],fontSize:12}}>{icons[log.type]}</span>
        <span style={{fontFamily:"'Syne',sans-serif",fontSize:9,fontWeight:700,color:colors[log.type],letterSpacing:"0.15em"}}>{log.type}</span>
        <span style={{fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>{log.time}</span>
      </div>
      <div style={{fontSize:11,color:"#C8D8E8",fontFamily:"'DM Mono',monospace",lineHeight:1.5}}>{log.message}</div>
      {log.detail && <div style={{fontSize:10,color:"#4A6080",fontFamily:"'DM Mono',monospace",marginTop:4,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{log.detail}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const AGENT_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export default function Terminal() {
  const BASE = 3342.50;
  const [price, setPrice]         = useState(BASE);
  const [prevPrice, setPrevPrice] = useState(BASE);
  const [livePrice, setLivePrice] = useState<number|null>(null);
  const [priceSource, setPS]      = useState<"LIVE"|"SIM">("SIM");
  const [candles, setCandles]     = useState<Candle[]>([]);
  const [closes, setCloses]       = useState<number[]>([BASE]);
  const [signal, setSignal]       = useState<Signal>({ dir:"WAIT", conf:0, ema:false, rsi:false, struct:false, rsiVal:50, atr:5, trend:"NEUTRAL" });
  const [trades, setTrades]       = useState<Trade[]>([]);
  const [logs, setLogs]           = useState<AgentLog[]>([]);
  const [agentOn, setAgentOn]     = useState(false);
  const [agentStatus, setAgentStatus] = useState<"IDLE"|"THINKING"|"READY">("IDLE");
  const [nextRun, setNextRun]     = useState<number>(0);
  const [countdown, setCountdown] = useState("");
  const [account, setAccount]     = useState({ equity:100, dailyPnl:0, trades:0 });
  const [rsiHist, setRsiHist]     = useState<number[]>([50]);
  const [pnlHist, setPnlHist]     = useState<number[]>([0]);
  const [ctTime, setCtTime]       = useState("--:--:--");
  const [ctH, setCtH]             = useState(8);
  const [ctM, setCtM]             = useState(0);
  const [tab, setTab]             = useState<"chart"|"agent"|"trades"|"rules">("chart");
  const tickRef    = useRef(0);
  const candleRef  = useRef<Candle>({ t:Date.now(), o:BASE, h:BASE, l:BASE, c:BASE });
  const agentTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const logId      = useRef(0);

  // ── Log helper ───────────────────────────────────────────────────────────
  const addLog = useCallback((type:AgentLog["type"], message:string, detail?:string) => {
    const now = new Date();
    const time = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
    setLogs(p=>[{ id:logId.current++, time, type, message, detail },...p].slice(0,80));
  }, []);

  // ── Real price ───────────────────────────────────────────────────────────
  useEffect(()=>{
    const fetch_price = async()=>{
      try {
        const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d");
        const d = await r.json();
        const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (p && p>1000) { setLivePrice(p); setPS("LIVE"); return; }
      } catch {}
      try {
        const r2 = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=XAU");
        const d2 = await r2.json();
        const usd = parseFloat(d2?.data?.rates?.USD||"0");
        if (usd>1000) { setLivePrice(usd); setPS("LIVE"); }
      } catch {}
    };
    fetch_price();
    const iv = setInterval(fetch_price, 30000);
    return ()=>clearInterval(iv);
  },[]);

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    const tick=()=>{
      const ct = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date());
      setCtTime(ct);
      const [h,m]=ct.split(":").map(Number);
      setCtH(h); setCtM(m);
    };
    tick(); const iv=setInterval(tick,1000); return ()=>clearInterval(iv);
  },[]);

  // ── Countdown ────────────────────────────────────────────────────────────
  useEffect(()=>{
    if (!agentOn) { setCountdown(""); return; }
    const iv = setInterval(()=>{
      const left = Math.max(0, nextRun - Date.now());
      const m = Math.floor(left/60000), s = Math.floor((left%60000)/1000);
      setCountdown(`${m}:${s.toString().padStart(2,"0")}`);
    },1000);
    return ()=>clearInterval(iv);
  },[agentOn, nextRun]);

  // ── Price sim + candles ──────────────────────────────────────────────────
  useEffect(()=>{
    const iv=setInterval(()=>{
      tickRef.current+=0.05;
      const t=tickRef.current;
      const base=livePrice||BASE;
      const np = base + Math.sin(t*0.08)*15 + Math.sin(t*0.4)*3 + Math.sin(t*1.1)*1.5 + (Math.random()-0.5)*0.6;
      setPrice(prev=>{ setPrevPrice(prev); return np; });
      setCloses(p=>[...p.slice(-199), np]);
      setRsiHist(p=>[...p.slice(-59), calcRSI([...p, np], 14)]);
      candleRef.current.h=Math.max(candleRef.current.h,np);
      candleRef.current.l=Math.min(candleRef.current.l,np);
      candleRef.current.c=np;
      if (Date.now()-candleRef.current.t>=4000) {
        const c={...candleRef.current};
        setCandles(p=>[...p.slice(-199),c]);
        candleRef.current={t:Date.now(),o:np,h:np,l:np,c:np};
      }
      setTrades(prev=>prev.map(tr=>{
        if (tr.status!=="OPEN") return tr;
        const p=(tr.type==="LONG"?(np-tr.entry):(tr.entry-np))/0.1;
        const pnl=p*tr.lot*0.01*100;
        if (tr.type==="LONG"  && np>=tr.tp2) return {...tr,status:"TP2",pnl:tr.risk*2};
        if (tr.type==="LONG"  && np>=tr.tp1) return {...tr,status:"TP1",pnl:tr.risk};
        if (tr.type==="LONG"  && np<=tr.sl)  return {...tr,status:"SL", pnl:-tr.risk};
        if (tr.type==="SHORT" && np<=tr.tp2) return {...tr,status:"TP2",pnl:tr.risk*2};
        if (tr.type==="SHORT" && np<=tr.tp1) return {...tr,status:"TP1",pnl:tr.risk};
        if (tr.type==="SHORT" && np>=tr.sl)  return {...tr,status:"SL", pnl:-tr.risk};
        return {...tr,pnl};
      }));
    },350);
    return ()=>clearInterval(iv);
  },[livePrice]);

  // ── Signal recalc ────────────────────────────────────────────────────────
  useEffect(()=>{
    if (candles.length>10 && closes.length>20) {
      setSignal(analyzeMarket(candles, closes));
    }
  },[candles, closes]);

  // ── Account ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const closed=trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0);
    const open=trades.filter(t=>t.status==="OPEN").reduce((s,t)=>s+t.pnl,0);
    const dp=closed+open;
    setAccount({equity:100+dp,dailyPnl:dp,trades:trades.length});
    setPnlHist(p=>[...p.slice(-59),dp]);
  },[trades]);

  // ── AI Agent ─────────────────────────────────────────────────────────────
  const runAgent = useCallback(async()=>{
    const sess = getSession(ctH, ctM);
    const sig  = signal;
    const openTrades = trades.filter(t=>t.status==="OPEN");
    const dailyPnl   = trades.reduce((s,t)=>s+(t.status!=="OPEN"?t.pnl:0),0);
    const tradesCount= trades.length;
    const currentPrice = price;

    setAgentStatus("THINKING");
    addLog("THINK", `Scanning XAU/USD @ $${f2(currentPrice)} | ${sess.name} | RSI ${f1(sig.rsiVal)} | EMA ${sig.trend} | Conf ${sig.conf}/3`);

    // Manage open trades first
    if (openTrades.length>0) {
      openTrades.forEach(tr=>{
        const pips = tr.type==="LONG" ? (currentPrice-tr.entry)/0.1 : (tr.entry-currentPrice)/0.1;
        addLog("MANAGE", `Managing ${tr.type} @ ${f2(tr.entry)} | Current: ${f2(currentPrice)} | P&L: ${pnlStr(tr.pnl)} | ${pips.toFixed(0)}p`);
      });
    }

    // Guard rails
    if (dailyPnl <= -6) {
      addLog("WARN", "Daily loss limit reached — $6.00. Agent standing down.", "Protecting capital. Will resume analysis next session.");
      setAgentStatus("READY"); return;
    }
    if (tradesCount >= 3) {
      addLog("SKIP", "Maximum 3 trades reached for today. Agent monitoring only.");
      setAgentStatus("READY"); return;
    }
    if (openTrades.length >= 2) {
      addLog("SKIP", `${openTrades.length} trades already open. Waiting for resolution before new entry.`);
      setAgentStatus("READY"); return;
    }

    // Build market context for AI
    const recentHigh = candles.length>0 ? Math.max(...candles.slice(-20).map(c=>c.h)).toFixed(2) : "N/A";
    const recentLow  = candles.length>0 ? Math.min(...candles.slice(-20).map(c=>c.l)).toFixed(2) : "N/A";
    const ema9  = closes.length>=9  ? f2(calcEMA(closes,9))  : "N/A";
    const ema21 = closes.length>=21 ? f2(calcEMA(closes,21)) : "N/A";
    const ema50 = closes.length>=50 ? f2(calcEMA(closes,50)) : "N/A";

    const context = `
You are a professional XAU/USD gold trader with 25 years of experience. You are running an automated paper trading agent.

CURRENT MARKET DATA:
- XAU/USD Price: $${f2(currentPrice)} (${priceSource})
- Chicago Time: ${ctTime}
- Session: ${sess.name} (${sess.quality} quality)
- Session Risk Multiplier: ${sess.mult}x
- EMA 9: ${ema9} | EMA 21: ${ema21} | EMA 50: ${ema50}
- EMA Trend: ${sig.trend}
- RSI (14): ${f1(sig.rsiVal)}
- ATR (14): ${f2(sig.atr)} pips
- Signal: ${sig.dir} with ${sig.conf}/3 confluence
- EMA Aligned: ${sig.ema} | RSI Confirmed: ${sig.rsi} | Structure: ${sig.struct}
- 20-bar High: $${recentHigh} | 20-bar Low: $${recentLow}

ACCOUNT:
- Equity: $${f2(100 + dailyPnl)}
- Daily P&L: ${pnlStr(dailyPnl)}
- Trades today: ${tradesCount}/3
- Open trades: ${openTrades.length}

STRATEGY RULES:
- Need 3/3 confluence in PRIME/GOOD sessions, 2/3 minimum
- Asian session: only take if all 3 confluences AND very clear setup
- SL: 20 pips (2.0 price points) beyond entry
- TP1: 1:1 (20 pips) | TP2: 2:1 (40 pips)
- Lot size for this session: ${(0.1 * sess.mult).toFixed(2)} lots
- Risk per trade: $${(2 * sess.mult).toFixed(2)}

YOUR DECISION:
Based on this data, decide whether to:
1. ENTER LONG - provide exact reasoning
2. ENTER SHORT - provide exact reasoning  
3. WAIT/SKIP - explain what you're waiting for

Respond in this EXACT JSON format only, no other text:
{
  "decision": "LONG" | "SHORT" | "WAIT",
  "confidence": 1-10,
  "reasoning": "2-3 sentence professional reasoning",
  "key_factor": "The single most important factor in your decision",
  "wait_for": "If WAIT, what specific condition needs to change (or null if LONG/SHORT)"
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:400,
          system:"You are an elite XAU/USD trader running an automated paper trading system. Always respond with valid JSON only.",
          messages:[{role:"user",content:context}]
        })
      });
      const data = await res.json();
      const text = data.content?.find((b:{type:string})=>b.type==="text")?.text||"{}";

      let parsed:{decision:string;confidence:number;reasoning:string;key_factor:string;wait_for:string|null};
      try {
        const clean = text.replace(/```json|```/g,"").trim();
        parsed = JSON.parse(clean);
      } catch {
        addLog("WARN","AI response parse error — skipping cycle",text.slice(0,100));
        setAgentStatus("READY"); return;
      }

      const { decision, confidence, reasoning, key_factor, wait_for } = parsed;

      if ((decision==="LONG"||decision==="SHORT") && confidence>=6) {
        // Execute paper trade
        const type = decision as "LONG"|"SHORT";
        const risk = parseFloat((2*sess.mult).toFixed(2));
        const lot  = parseFloat((0.1*sess.mult).toFixed(2));
        const sl   = type==="LONG" ? currentPrice-2 : currentPrice+2;
        const tp1  = type==="LONG" ? currentPrice+2 : currentPrice-2;
        const tp2  = type==="LONG" ? currentPrice+4 : currentPrice-4;
        const now  = new Date();
        const time = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false});

        setTrades(p=>[...p,{
          id:Date.now(), type, entry:currentPrice, sl, tp1, tp2,
          lot, risk, status:"OPEN", pnl:0, time,
          session:sess.abbr, reason:reasoning
        }]);

        addLog("TRADE",
          `${type} EXECUTED @ $${f2(currentPrice)} | ${lot} lot | SL: $${f2(sl)} | TP1: $${f2(tp1)} | TP2: $${f2(tp2)} | Confidence: ${confidence}/10`,
          `📊 ${reasoning}\n🎯 Key factor: ${key_factor}`
        );
      } else if (decision==="WAIT"||confidence<6) {
        addLog("SKIP",
          `WAIT — Confidence ${confidence}/10 | ${key_factor}`,
          `${reasoning}${wait_for?`\n⏳ Waiting for: ${wait_for}`:""}`
        );
      } else {
        addLog("SKIP", `No action — ${reasoning}`, key_factor);
      }

    } catch (err) {
      addLog("WARN","Agent API error — will retry next cycle", String(err).slice(0,80));
    }

    setAgentStatus("READY");
  }, [ctH, ctM, signal, trades, price, closes, candles, priceSource, ctTime, addLog]);

  // ── Agent scheduler ──────────────────────────────────────────────────────
  useEffect(()=>{
    if (!agentOn) {
      if (agentTimer.current) clearTimeout(agentTimer.current);
      setAgentStatus("IDLE");
      return;
    }
    const schedule = ()=>{
      const next = Date.now() + AGENT_INTERVAL_MS;
      setNextRun(next);
      agentTimer.current = setTimeout(()=>{ runAgent(); schedule(); }, AGENT_INTERVAL_MS);
    };
    // Run immediately on start
    runAgent();
    schedule();
    return ()=>{ if (agentTimer.current) clearTimeout(agentTimer.current); };
  },[agentOn]); // eslint-disable-line

  const toggleAgent = ()=>{
    if (!agentOn) {
      addLog("THINK","🤖 AI Agent activated — 25yr Gold Trader online","Scanning every 5 minutes. Paper trading mode active.");
      setAgentOn(true);
    } else {
      addLog("WARN","Agent deactivated by user.","All open positions remain. Resume anytime.");
      setAgentOn(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const sess     = getSession(ctH, ctM);
  const risk     = parseFloat((2*sess.mult).toFixed(2));
  const lot      = parseFloat((0.1*sess.mult).toFixed(2));
  const priceUp  = price>=prevPrice;
  const riskHit  = account.dailyPnl<=-6;
  const maxTrade = account.trades>=3;
  const wins     = trades.filter(t=>["TP1","TP2"].includes(t.status)).length;
  const losses   = trades.filter(t=>t.status==="SL").length;
  const openT    = trades.filter(t=>t.status==="OPEN");

  const statusColor = { IDLE:"#4A6080", THINKING:"#F5C842", READY:"#00D97E" }[agentStatus];
  const statusLabel = { IDLE:"OFFLINE", THINKING:"THINKING...", READY:"MONITORING" }[agentStatus];

  return (
    <div style={{minHeight:"100vh",background:"#03050A",color:"#C8D8E8",display:"flex",flexDirection:"column",fontFamily:"'DM Mono',monospace"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap');
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        @keyframes thinking{0%{opacity:0.3}50%{opacity:1}100%{opacity:0.3}}
        .pulse{animation:pulse 2s ease-in-out infinite}
        .thinking{animation:thinking 1s ease-in-out infinite}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-track{background:#03050A}
        ::-webkit-scrollbar-thumb{background:#1A2535;border-radius:2px}
      `}</style>

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header style={{background:"#070C14",borderBottom:"1px solid #1A2535",padding:"0 20px",height:58,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:36,height:36,borderRadius:6,background:"linear-gradient(135deg,#D4A843,#8B6914)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Syne',sans-serif",fontWeight:900,color:"#03050A",fontSize:14}}>AU</div>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:800,color:"#E8F4FF",letterSpacing:"0.06em"}}>XAU/USD COMMAND</div>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>24/7 AI PAPER TRADER · {priceSource}</div>
          </div>
        </div>

        {/* Price */}
        <div style={{display:"flex",alignItems:"baseline",gap:10}}>
          <span style={{fontSize:9,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>XAU/USD</span>
          <span style={{fontSize:30,fontWeight:700,fontFamily:"'Space Mono',monospace",color:priceUp?"#00D97E":"#FF3B5C",transition:"color 0.3s",textShadow:priceUp?"0 0 25px rgba(0,217,126,0.4)":"0 0 25px rgba(255,59,92,0.4)"}}>
            {f2(price)}
          </span>
          <span style={{fontSize:12,color:priceUp?"#00D97E":"#FF3B5C",fontFamily:"'Space Mono',monospace"}}>
            {priceUp?"▲":"▼"}{Math.abs(price-BASE).toFixed(2)}
          </span>
        </div>

        {/* Right */}
        <div style={{display:"flex",alignItems:"center",gap:20}}>
          {/* Agent toggle */}
          <button onClick={toggleAgent} style={{
            padding:"10px 20px",
            background:agentOn?"rgba(0,217,126,0.1)":"rgba(212,168,67,0.1)",
            border:`1px solid ${agentOn?"rgba(0,217,126,0.4)":"rgba(212,168,67,0.4)"}`,
            borderRadius:6,
            color:agentOn?"#00D97E":"#D4A843",
            fontFamily:"'Syne',sans-serif",
            fontWeight:700,
            fontSize:11,
            letterSpacing:"0.12em",
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            gap:8,
            transition:"all 0.2s",
            boxShadow:agentOn?"0 0 20px rgba(0,217,126,0.15)":"none",
          }}>
            <div style={{width:8,height:8,borderRadius:"50%",background:statusColor}} className={agentOn?"pulse":""}/>
            {agentOn ? `AI AGENT ON · ${statusLabel}` : "START AI AGENT"}
          </button>
          {/* Clock */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:5,padding:"6px 14px",textAlign:"center"}}>
            <div style={{fontSize:18,color:"#D4A843",fontFamily:"'Space Mono',monospace",fontWeight:700,letterSpacing:"0.06em"}}>{ctTime}</div>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>CT</div>
          </div>
          {/* Equity */}
          <div style={{background:account.equity>=100?"rgba(0,217,126,0.06)":"rgba(255,59,92,0.06)",border:`1px solid ${account.equity>=100?"rgba(0,217,126,0.2)":"rgba(255,59,92,0.2)"}`,borderRadius:5,padding:"6px 14px",textAlign:"center"}}>
            <div style={{fontSize:16,color:account.equity>=100?"#00D97E":"#FF3B5C",fontFamily:"'Space Mono',monospace",fontWeight:700}}>${f2(account.equity)}</div>
            <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>EQUITY</div>
          </div>
        </div>
      </header>

      {/* ── SESSION + AGENT BANNER ──────────────────────────────────────── */}
      <div style={{background:`linear-gradient(90deg,${sess.color}15,transparent 60%)`,borderBottom:"1px solid #1A2535",padding:"7px 20px",display:"flex",alignItems:"center",gap:24}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:sess.color}} className="pulse"/>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:11,color:sess.color,letterSpacing:"0.1em"}}>{sess.name}</span>
          <span style={{fontSize:10,color:"#4A6080"}}>{sess.desc}</span>
        </div>
        <div style={{width:1,height:18,background:"#1A2535"}}/>
        <div style={{display:"flex",gap:16,fontSize:10}}>
          {[{l:"MULT",v:`${sess.mult}×`,c:sess.color},{l:"LOT",v:lot.toFixed(2),c:"#D4A843"},{l:"RISK",v:`$${risk}`,c:"#00D97E"},{l:"ATR",v:`${f2(signal.atr)}p`,c:"#3B9EFF"}].map(x=>(
            <div key={x.l} style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.12em",fontSize:9}}>{x.l}</span>
              <span style={{fontFamily:"'Space Mono',monospace",color:x.c,fontWeight:700,fontSize:12}}>{x.v}</span>
            </div>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {agentOn && (
            <div style={{padding:"3px 12px",background:"rgba(0,217,126,0.08)",border:"1px solid rgba(0,217,126,0.2)",borderRadius:4,fontSize:9,color:"#00D97E",fontFamily:"'Syne',sans-serif",fontWeight:700,letterSpacing:"0.12em",display:"flex",gap:6,alignItems:"center"}}>
              <span className={agentStatus==="THINKING"?"thinking":""}>{agentStatus==="THINKING"?"⟳":"◎"}</span>
              {agentStatus==="THINKING" ? "AGENT THINKING..." : `NEXT SCAN: ${countdown}`}
            </div>
          )}
          {riskHit  && <span style={{padding:"3px 10px",background:"rgba(255,59,92,0.1)",border:"1px solid rgba(255,59,92,0.3)",borderRadius:4,fontSize:9,color:"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700}}>⛔ DAILY LIMIT HIT</span>}
          {maxTrade && !riskHit && <span style={{padding:"3px 10px",background:"rgba(212,168,67,0.1)",border:"1px solid rgba(212,168,67,0.3)",borderRadius:4,fontSize:9,color:"#D4A843",fontFamily:"'Syne',sans-serif",fontWeight:700}}>⚠ MAX 3 TRADES</span>}
        </div>
      </div>

      {/* ── MAIN 3-COL GRID ─────────────────────────────────────────────── */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"256px 1fr 256px",gap:"1px",background:"#1A2535"}}>

        {/* ── LEFT ────────────────────────────────────────────────── */}
        <div style={{background:"#070C14",padding:"14px",display:"flex",flexDirection:"column",gap:"12px",overflowY:"auto"}}>

          {/* Signal */}
          <div style={{background:signal.dir==="LONG"?"rgba(0,217,126,0.05)":signal.dir==="SHORT"?"rgba(255,59,92,0.05)":"rgba(212,168,67,0.04)",border:`1px solid ${signal.dir==="LONG"?"rgba(0,217,126,0.22)":signal.dir==="SHORT"?"rgba(255,59,92,0.22)":"rgba(212,168,67,0.15)"}`,borderRadius:4,padding:"14px"}}>
            <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:10}}>SIGNAL ENGINE</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800,color:signal.dir==="LONG"?"#00D97E":signal.dir==="SHORT"?"#FF3B5C":"#D4A843",letterSpacing:"0.05em",textShadow:signal.dir==="LONG"?"0 0 25px rgba(0,217,126,0.5)":signal.dir==="SHORT"?"0 0 25px rgba(255,59,92,0.5)":"none"}}>
                {signal.dir}
              </div>
              <div style={{display:"flex",gap:5}}>
                {[1,2,3].map(i=>(
                  <div key={i} style={{width:22,height:22,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,background:signal.conf>=i?(signal.dir==="LONG"?"rgba(0,217,126,0.2)":signal.dir==="SHORT"?"rgba(255,59,92,0.2)":"rgba(212,168,67,0.15)"):"#0A1120",border:`1px solid ${signal.conf>=i?(signal.dir==="LONG"?"rgba(0,217,126,0.4)":signal.dir==="SHORT"?"rgba(255,59,92,0.4)":"rgba(212,168,67,0.3)"):"#1A2535"}`,color:signal.conf>=i?(signal.dir==="LONG"?"#00D97E":signal.dir==="SHORT"?"#FF3B5C":"#D4A843"):"#1A2535"}}>
                    {signal.conf>=i?"✓":"·"}
                  </div>
                ))}
              </div>
            </div>
            {[{l:"EMA Stack",ok:signal.ema,v:signal.trend},{l:"RSI",ok:signal.rsi,v:f1(signal.rsiVal)},{l:"Structure",ok:signal.struct,v:signal.struct?"Swept":"Pending"}].map(x=>(
              <div key={x.l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:16,height:16,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,background:x.ok?"rgba(0,217,126,0.12)":"rgba(255,59,92,0.08)",color:x.ok?"#00D97E":"#FF3B5C"}}>{x.ok?"✓":"✗"}</div>
                  <span style={{fontSize:11,color:"#4A6080"}}>{x.l}</span>
                </div>
                <span style={{fontSize:11,fontFamily:"'Space Mono',monospace",color:"#C8D8E8"}}>{x.v}</span>
              </div>
            ))}
            <div style={{marginTop:8,padding:"6px 8px",background:"rgba(0,0,0,0.3)",borderRadius:3,fontSize:10,color:"#D4A843",lineHeight:1.5}}>{signal.trend} trend · ATR {f2(signal.atr)}p</div>
          </div>

          {/* RSI */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>RSI (14)</span>
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:14,color:signal.rsiVal>70?"#FF3B5C":signal.rsiVal<30?"#00D97E":"#F5C842",fontWeight:700}}>{f1(signal.rsiVal)}</span>
            </div>
            <RsiBar value={signal.rsiVal}/>
            <div style={{marginTop:8}}>
              <Spark data={rsiHist} color={signal.rsiVal>70?"#FF3B5C":signal.rsiVal<30?"#00D97E":"#3B9EFF"} h={32}/>
            </div>
          </div>

          {/* Lot table */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>LOT CALC</span>
              <span style={{fontSize:9,padding:"2px 7px",borderRadius:3,background:`${sess.color}18`,border:`1px solid ${sess.color}35`,color:sess.color,fontFamily:"'Syne',sans-serif",fontWeight:700}}>{sess.abbr}</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3,marginBottom:4}}>
              {["SL","LOT","RISK"].map(h=><div key={h} style={{textAlign:"center",padding:"3px",background:"#0F1929",borderRadius:2,fontSize:8,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em"}}>{h}</div>)}
            </div>
            {[15,20,25,30].map(sl=>{
              const r=parseFloat((2*sess.mult).toFixed(2));
              const l=parseFloat((0.1*sess.mult).toFixed(2));
              return (
                <div key={sl} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:3,marginBottom:3}}>
                  <div style={{textAlign:"center",padding:"4px",background:"#0F1929",borderRadius:2,fontSize:10,color:"#4A6080",fontFamily:"monospace"}}>{sl}p</div>
                  <div style={{textAlign:"center",padding:"4px",background:"#0F1929",borderRadius:2,fontSize:10,color:"#D4A843",fontFamily:"'Space Mono',monospace",fontWeight:700}}>{l.toFixed(2)}</div>
                  <div style={{textAlign:"center",padding:"4px",background:"#0F1929",borderRadius:2,fontSize:10,color:"#00D97E",fontFamily:"monospace"}}>${r}</div>
                </div>
              );
            })}
          </div>

          {/* Account */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"12px"}}>
            <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:10}}>ACCOUNT</div>
            {[{l:"Capital",v:"$100.00",c:"#4A6080"},{l:"Leverage",v:"1:1000",c:"#3B9EFF"},{l:"Equity",v:`$${f2(account.equity)}`,c:account.equity>=100?"#00D97E":"#FF3B5C"},{l:"Daily P&L",v:`${account.dailyPnl>=0?"+":""}$${f2(account.dailyPnl)}`,c:account.dailyPnl>=0?"#00D97E":"#FF3B5C"},{l:"Trades",v:`${account.trades}/3`,c:maxTrade?"#FF3B5C":"#D4A843"},{l:"Open",v:`${openT.length}`,c:"#3B9EFF"}].map(x=>(
              <div key={x.l} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:11,color:"#4A6080"}}>{x.l}</span>
                <span style={{fontSize:11,fontFamily:"'Space Mono',monospace",fontWeight:700,color:x.c}}>{x.v}</span>
              </div>
            ))}
            <div style={{marginTop:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:8,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.12em"}}>DAILY BUFFER</span>
                <span style={{fontSize:9,fontFamily:"monospace",color:Math.max(0,6+account.dailyPnl)>3?"#00D97E":"#FF3B5C"}}>${f2(Math.max(0,6+account.dailyPnl))}</span>
              </div>
              <div style={{height:5,background:"#0F1929",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${clamp(((6+account.dailyPnl)/6)*100,0,100)}%`,background:account.dailyPnl>-3?"#00D97E":account.dailyPnl>-5?"#F5C842":"#FF3B5C",borderRadius:3,transition:"width 0.8s"}}/>
              </div>
            </div>
            <div style={{marginTop:8}}>
              <div style={{fontSize:8,color:"#4A6080",letterSpacing:"0.12em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:4}}>P&L CURVE</div>
              <Spark data={pnlHist} color={account.dailyPnl>=0?"#00D97E":"#FF3B5C"} h={34}/>
            </div>
          </div>
        </div>

        {/* ── CENTER ──────────────────────────────────────────────── */}
        <div style={{background:"#070C14",display:"flex",flexDirection:"column"}}>
          {/* Tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #1A2535",background:"#03050A"}}>
            {(["chart","agent","trades","rules"] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{padding:"11px 20px",fontSize:10,letterSpacing:"0.14em",fontFamily:"'Syne',sans-serif",fontWeight:700,textTransform:"uppercase",border:"none",cursor:"pointer",borderBottom:tab===t?"2px solid #D4A843":"2px solid transparent",background:tab===t?"rgba(212,168,67,0.05)":"transparent",color:tab===t?"#D4A843":"#4A6080",transition:"all 0.2s"}}>
                {t==="agent"?`AGENT ${agentOn?"●":"○"}`:""}
                {t!=="agent"?t:""}
              </button>
            ))}
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",paddingRight:16,fontSize:9,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em",gap:6}}>
              {wins>0&&<span style={{color:"#00D97E"}}>W:{wins}</span>}
              {losses>0&&<span style={{color:"#FF3B5C"}}>L:{losses}</span>}
              <span>PAPER TRADE</span>
            </div>
          </div>

          {/* CHART */}
          {tab==="chart" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",padding:"14px",gap:"12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <span style={{fontSize:9,color:"#4A6080",letterSpacing:"0.15em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>XAU/USD · 4s BARS</span>
                  {[{c:"#F5C842",l:"EMA9"},{c:"#FF8C42",l:"EMA21"},{c:"#FF3B5C",l:"EMA50"}].map(e=>(
                    <div key={e.l} style={{display:"flex",gap:4,alignItems:"center"}}>
                      <div style={{width:14,height:2,background:e.c,borderRadius:1}}/>
                      <span style={{fontSize:8,color:"#4A6080"}}>{e.l}</span>
                    </div>
                  ))}
                </div>
                <div style={{fontSize:9,color:"#4A6080",fontFamily:"monospace",display:"flex",gap:10}}>
                  <span>H: <span style={{color:"#FF3B5C"}}>{candles.length>0?Math.max(...candles.slice(-20).map(c=>c.h)).toFixed(2):f2(price)}</span></span>
                  <span>L: <span style={{color:"#00D97E"}}>{candles.length>0?Math.min(...candles.slice(-20).map(c=>c.l)).toFixed(2):f2(price)}</span></span>
                </div>
              </div>
              <div style={{flex:1,background:"#03050A",border:"1px solid #1A2535",borderRadius:4,overflow:"hidden",minHeight:220}}>
                <CandleChart candles={candles} price={price} closes={closes} color={sess.color}/>
              </div>

              {/* Agent activate CTA or status */}
              {!agentOn ? (
                <div style={{background:"rgba(212,168,67,0.06)",border:"1px solid rgba(212,168,67,0.2)",borderRadius:6,padding:"16px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,color:"#D4A843",letterSpacing:"0.08em",marginBottom:6}}>🤖 AI PAPER TRADER READY</div>
                  <div style={{fontSize:11,color:"#4A6080",fontFamily:"'DM Mono',monospace",marginBottom:12,lineHeight:1.6}}>
                    25-year gold trading AI. Scans every 5 min.<br/>Makes decisions. Auto-executes paper trades. Journals every thought.
                  </div>
                  <button onClick={toggleAgent} style={{padding:"12px 28px",background:"linear-gradient(135deg,rgba(212,168,67,0.15),rgba(212,168,67,0.08))",border:"1px solid rgba(212,168,67,0.4)",borderRadius:5,color:"#D4A843",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:12,letterSpacing:"0.12em",cursor:"pointer"}}>
                    ACTIVATE AI AGENT →
                  </button>
                </div>
              ) : (
                <div style={{background:"rgba(0,217,126,0.05)",border:"1px solid rgba(0,217,126,0.2)",borderRadius:6,padding:"12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:11,color:"#00D97E",marginBottom:3}}>
                      <span className={agentStatus==="THINKING"?"thinking":""}>◎</span> AGENT ACTIVE — {statusLabel}
                    </div>
                    <div style={{fontSize:10,color:"#4A6080",fontFamily:"'DM Mono',monospace"}}>Next scan in {countdown} · {logs.length} decisions logged</div>
                  </div>
                  <button onClick={toggleAgent} style={{padding:"6px 14px",background:"rgba(255,59,92,0.1)",border:"1px solid rgba(255,59,92,0.3)",borderRadius:4,color:"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:10,cursor:"pointer",letterSpacing:"0.1em"}}>STOP</button>
                </div>
              )}

              {/* Open trades mini */}
              {openT.length>0 && (
                <div>
                  <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:6}}>OPEN POSITIONS</div>
                  {openT.map(tr=>(
                    <div key={tr.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"#0A1120",border:`1px solid ${tr.pnl>=0?"rgba(0,217,126,0.2)":"rgba(255,59,92,0.2)"}`,borderRadius:4,marginBottom:4}}>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{fontSize:10,padding:"2px 7px",borderRadius:3,background:tr.type==="LONG"?"rgba(0,217,126,0.12)":"rgba(255,59,92,0.12)",color:tr.type==="LONG"?"#00D97E":"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700}}>{tr.type}</span>
                        <span style={{fontSize:10,fontFamily:"monospace",color:"#4A6080"}}>{f2(tr.entry)}</span>
                        <span style={{fontSize:9,color:"#4A6080"}}>→ TP1:{f2(tr.tp1)} TP2:{f2(tr.tp2)}</span>
                      </div>
                      <span style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:12,color:tr.pnl>=0?"#00D97E":"#FF3B5C"}}>{pnlStr(tr.pnl)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AGENT LOG */}
          {tab==="agent" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",padding:"14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:11,color:"#00D97E",marginBottom:2}}>AI AGENT DECISION LOG</div>
                  <div style={{fontSize:9,color:"#4A6080",fontFamily:"'DM Mono',monospace"}}>Every scan, every thought, every trade — logged in real time</div>
                </div>
                {!agentOn && <button onClick={toggleAgent} style={{padding:"8px 16px",background:"rgba(212,168,67,0.1)",border:"1px solid rgba(212,168,67,0.3)",borderRadius:4,color:"#D4A843",fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:10,cursor:"pointer",letterSpacing:"0.1em"}}>START AGENT →</button>}
              </div>

              {logs.length===0 ? (
                <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#4A6080"}}>
                  <div style={{fontSize:40,marginBottom:16,opacity:0.3}}>◎</div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:12,fontWeight:700,letterSpacing:"0.2em",marginBottom:8}}>AGENT OFFLINE</div>
                  <div style={{fontSize:11,fontFamily:"'DM Mono',monospace",textAlign:"center",lineHeight:1.6}}>Start the AI Agent to see<br/>every decision logged here live</div>
                </div>
              ) : (
                <div style={{flex:1,overflowY:"auto",paddingRight:4}}>
                  {logs.map(log=><LogEntry key={log.id} log={log}/>)}
                </div>
              )}
            </div>
          )}

          {/* TRADES */}
          {tab==="trades" && (
            <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <span style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>PAPER TRADE LOG</span>
                <div style={{display:"flex",gap:6}}>
                  {[{l:`W:${wins}`,c:"#00D97E",bg:"rgba(0,217,126,0.1)"},{l:`L:${losses}`,c:"#FF3B5C",bg:"rgba(255,59,92,0.1)"},{l:`O:${openT.length}`,c:"#F5C842",bg:"rgba(245,200,66,0.1)"}].map(x=>(
                    <span key={x.l} style={{padding:"2px 8px",background:x.bg,borderRadius:3,fontSize:10,color:x.c,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{x.l}</span>
                  ))}
                </div>
              </div>

              {trades.length===0 && (
                <div style={{textAlign:"center",padding:"60px 0",color:"#4A6080"}}>
                  <div style={{fontSize:36,marginBottom:12,opacity:0.2}}>◈</div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:12,fontWeight:700,letterSpacing:"0.2em",marginBottom:6}}>NO TRADES YET</div>
                  <div style={{fontSize:10,fontFamily:"'DM Mono',monospace"}}>Start the AI Agent to auto-execute paper trades</div>
                </div>
              )}

              {trades.map(tr=>{
                const sc=tr.status==="OPEN"?"#F5C842":["TP1","TP2"].includes(tr.status)?"#00D97E":"#FF3B5C";
                return (
                  <div key={tr.id} style={{background:"#0A1120",border:`1px solid ${["TP1","TP2"].includes(tr.status)?"rgba(0,217,126,0.18)":tr.status==="SL"?"rgba(255,59,92,0.18)":"rgba(245,200,66,0.12)"}`,borderRadius:5,padding:"12px",marginBottom:8,animation:"fadeIn 0.3s ease-out"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                      <div style={{display:"flex",gap:7,alignItems:"center"}}>
                        <span style={{fontSize:10,padding:"2px 8px",borderRadius:3,background:tr.type==="LONG"?"rgba(0,217,126,0.12)":"rgba(255,59,92,0.12)",color:tr.type==="LONG"?"#00D97E":"#FF3B5C",fontFamily:"'Syne',sans-serif",fontWeight:700}}>{tr.type}</span>
                        <span style={{fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>{tr.time}</span>
                        <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:"rgba(59,158,255,0.1)",color:"#3B9EFF",fontFamily:"'Syne',sans-serif",fontWeight:600}}>{tr.session}</span>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:13,color:tr.pnl>=0?"#00D97E":"#FF3B5C"}}>{pnlStr(tr.pnl)}</span>
                        <span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:`${sc}18`,color:sc,fontFamily:"'Syne',sans-serif",fontWeight:700}}>{tr.status}</span>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginBottom:6}}>
                      {[{l:"ENTRY",v:f2(tr.entry)},{l:"SL",v:f2(tr.sl)},{l:"TP1",v:f2(tr.tp1)},{l:"TP2",v:f2(tr.tp2)},{l:"LOT",v:tr.lot.toFixed(2)}].map(x=>(
                        <div key={x.l} style={{background:"#0F1929",borderRadius:3,padding:"4px 6px"}}>
                          <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em",marginBottom:2}}>{x.l}</div>
                          <div style={{fontSize:10,fontFamily:"'Space Mono',monospace",color:"#E8F4FF"}}>{x.v}</div>
                        </div>
                      ))}
                    </div>
                    {tr.reason && <div style={{fontSize:9,color:"#4A6080",fontFamily:"'DM Mono',monospace",lineHeight:1.5,borderTop:"1px solid #1A2535",paddingTop:6}}>💬 {tr.reason}</div>}
                  </div>
                );
              })}

              {trades.length>0 && (
                <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:5,padding:"12px",marginTop:4}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {[
                      {l:"WIN RATE",v:trades.filter(t=>t.status!=="OPEN").length>0?`${Math.round(wins/trades.filter(t=>t.status!=="OPEN").length*100)}%`:"—",c:"#00D97E"},
                      {l:"BEST",v:`+$${Math.max(0,...trades.map(t=>t.pnl)).toFixed(2)}`,c:"#00D97E"},
                      {l:"CLOSED P&L",v:`${trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0)>=0?"+":""}$${trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0).toFixed(2)}`,c:trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0)>=0?"#00D97E":"#FF3B5C"},
                      {l:"TOTAL",v:`${trades.length}`,c:"#D4A843"},
                    ].map(x=>(
                      <div key={x.l} style={{background:"#0F1929",borderRadius:4,padding:"8px",textAlign:"center"}}>
                        <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.12em",marginBottom:4}}>{x.l}</div>
                        <div style={{fontSize:14,fontFamily:"'Space Mono',monospace",fontWeight:700,color:x.c}}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RULES */}
          {tab==="rules" && (
            <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
              <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:14}}>AI AGENT RULES & SESSION SCHEDULE</div>
              <div style={{background:"rgba(0,217,126,0.05)",border:"1px solid rgba(0,217,126,0.15)",borderRadius:5,padding:"12px",marginBottom:12}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:10,color:"#00D97E",letterSpacing:"0.15em",marginBottom:8}}>HOW THE AI AGENT WORKS</div>
                {["Every 5 minutes: wakes up, reads market, decides LONG/SHORT/WAIT","Needs 3/3 confluence + confidence ≥6/10 to execute a trade","Auto-scales lot size based on current trading session","Respects max 3 trades/day and $6 daily loss limit","Manages open trades and moves SL to breakeven after TP1","Every decision is logged with full reasoning in Agent tab"].map((r,i)=>(
                  <div key={i} style={{display:"flex",gap:8,marginBottom:5,fontSize:11,color:"#C8D8E8",fontFamily:"'DM Mono',monospace",lineHeight:1.4}}>
                    <span style={{color:"#00D97E",flexShrink:0}}>›</span>{r}
                  </div>
                ))}
              </div>
              {[
                {time:"07–10 CT",name:"London/NY Overlap",color:"#00D97E",mult:"1.0×",note:"PRIME — Full size. Agent most active."},
                {time:"02–07 CT",name:"London Open",      color:"#F5C842",mult:"0.8×",note:"GOOD — 80% size. Breakout focus."},
                {time:"10–12 CT",name:"NY Morning",       color:"#F5C842",mult:"0.8×",note:"GOOD — 80% size. Trend continuation."},
                {time:"14–19 CT",name:"NY Afternoon",     color:"#3B9EFF",mult:"0.6×",note:"DECENT — 60% size. Trend only."},
                {time:"12–14 CT",name:"NY Midday",        color:"#FF8C42",mult:"0.4×",note:"WEAK — 40% size. Scalps only."},
                {time:"19–02 CT",name:"Asian Session",    color:"#8B5CF6",mult:"0.25×",note:"MINIMAL — 25% size. High bar."},
              ].map((s,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",marginBottom:4,borderRadius:4,background:"#0A1120",border:`1px solid ${s.color}20`}}>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    <div style={{width:4,height:28,borderRadius:2,background:s.color,opacity:0.7}}/>
                    <div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:11,color:s.color}}>{s.name}</div>
                      <div style={{fontSize:9,color:"#4A6080",fontFamily:"monospace"}}>{s.time} · {s.note}</div>
                    </div>
                  </div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:16,color:s.color}}>{s.mult}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT ───────────────────────────────────────────────── */}
        <div style={{background:"#070C14",padding:"14px",display:"flex",flexDirection:"column",gap:"12px",overflowY:"auto"}}>

          {/* Agent status card */}
          <div style={{background:agentOn?"rgba(0,217,126,0.05)":"rgba(212,168,67,0.04)",border:`1px solid ${agentOn?"rgba(0,217,126,0.22)":"rgba(212,168,67,0.15)"}`,borderRadius:4,padding:"14px"}}>
            <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:8}}>AI AGENT STATUS</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:statusColor,boxShadow:agentOn?`0 0 10px ${statusColor}`:"none"}} className={agentOn?"pulse":""}/>
              <span style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:13,color:statusColor,letterSpacing:"0.06em"}}>{statusLabel}</span>
            </div>
            <div style={{fontSize:10,color:"#4A6080",fontFamily:"'DM Mono',monospace",lineHeight:1.6,marginBottom:10}}>
              {agentOn ? `Scanning every 5 min\nNext: ${countdown}\n${logs.length} decisions made` : "Start agent to begin\nautomated paper trading"}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {[{l:"SCANS",v:logs.filter(l=>l.type==="THINK").length.toString(),c:"#3B9EFF"},{l:"TRADES",v:trades.length.toString(),c:"#D4A843"},{l:"WINS",v:wins.toString(),c:"#00D97E"},{l:"LOSSES",v:losses.toString(),c:"#FF3B5C"}].map(x=>(
                <div key={x.l} style={{background:"#0A1120",borderRadius:3,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.12em",marginBottom:3}}>{x.l}</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:16,color:x.c}}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Session now */}
          <div style={{background:`${sess.color}0D`,border:`1px solid ${sess.color}30`,borderRadius:4,padding:"12px"}}>
            <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:6}}>CURRENT SESSION</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:13,color:sess.color,marginBottom:3}}>{sess.name}</div>
            <div style={{fontSize:10,color:"#C8D8E8",fontFamily:"'DM Mono',monospace",marginBottom:8,lineHeight:1.5}}>{sess.desc}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {[{l:"MULTIPLIER",v:`${sess.mult}×`,c:sess.color},{l:"QUALITY",v:sess.quality,c:sess.color},{l:"ACTIVE LOT",v:lot.toFixed(2),c:"#D4A843"},{l:"RISK/TRADE",v:`$${risk}`,c:"#00D97E"}].map(x=>(
                <div key={x.l} style={{background:"rgba(0,0,0,0.3)",borderRadius:3,padding:"6px 8px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.1em",marginBottom:3}}>{x.l}</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:12,color:x.c}}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Key levels */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"12px"}}>
            <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:10}}>KEY LEVELS</div>
            {[{l:"Prev Day H",v:(price+18.4).toFixed(2),c:"#FF3B5C"},{l:"Session H",v:(price+8.2).toFixed(2),c:"#3B9EFF"},{l:"Round Lvl",v:(Math.round(price/10)*10).toFixed(2),c:"#4A6080"},{l:"▶ PRICE",v:price.toFixed(2),c:sess.color},{l:"Session L",v:(price-7.6).toFixed(2),c:"#3B9EFF"},{l:"Prev Day L",v:(price-15.8).toFixed(2),c:"#00D97E"}].map(x=>(
              <div key={x.l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                <span style={{fontSize:10,color:"#4A6080"}}>{x.l}</span>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:x.c,fontWeight:700}}>{x.v}</span>
              </div>
            ))}
          </div>

          {/* Session timeline */}
          <div style={{background:"#0A1120",border:"1px solid #1A2535",borderRadius:4,padding:"12px"}}>
            <div style={{fontSize:9,color:"#4A6080",letterSpacing:"0.18em",fontFamily:"'Syne',sans-serif",fontWeight:600,marginBottom:8}}>SESSION TIMELINE</div>
            {[{t:"07–10",n:"L/NY Overlap",c:"#00D97E",m:"100%"},{t:"02–07",n:"London",c:"#F5C842",m:"80%"},{t:"10–12",n:"NY Morning",c:"#F5C842",m:"80%"},{t:"14–19",n:"NY Aftn",c:"#3B9EFF",m:"60%"},{t:"12–14",n:"Midday",c:"#FF8C42",m:"40%"},{t:"19–02",n:"Asian",c:"#8B5CF6",m:"25%"}].map((s,i)=>{
              const isNow=sess.abbr===["L/NY","LON","NYM","NYA","NYD","ASI"][i];
              return (
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 7px",marginBottom:3,borderRadius:3,background:isNow?`${s.c}12`:"transparent",border:`1px solid ${isNow?`${s.c}25`:"transparent"}`,transition:"all 0.3s"}}>
                  <div>
                    <div style={{fontSize:10,color:isNow?s.c:"#4A6080",fontFamily:"'DM Mono',monospace",fontWeight:isNow?700:400}}>{s.n}{isNow?" ←":""}</div>
                    <div style={{fontSize:8,color:"#2A3545",fontFamily:"monospace"}}>{s.t} CT</div>
                  </div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:s.c,fontWeight:700}}>{s.m}</div>
                </div>
              );
            })}
          </div>

          {/* Iron rules */}
          <div style={{background:"rgba(255,59,92,0.04)",border:"1px solid rgba(255,59,92,0.14)",borderRadius:4,padding:"12px"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:9,color:"#FF3B5C",letterSpacing:"0.2em",marginBottom:8}}>AGENT HARD LIMITS</div>
            {["Max 3 trades per day — absolute","$6 daily loss → agent stops fully","Confidence ≥6/10 required to trade","1 new trade at a time max","Asian: 25% size, very high bar","Paper mode — no real money risk"].map((r,i)=>(
              <div key={i} style={{display:"flex",gap:7,marginBottom:5,fontSize:10,color:"#C8D8E8",fontFamily:"'DM Mono',monospace"}}>
                <span style={{color:"#FF3B5C",flexShrink:0}}>—</span>{r}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer style={{background:"#03050A",borderTop:"1px solid #1A2535",padding:"7px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:8,color:"#4A6080",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>XAU/USD AI PAPER TRADER · 25YR STRATEGY · $100 · 1:1000 · 24/7</span>
        <span style={{fontSize:8,color:"#4A6080",fontFamily:"'Syne',sans-serif",letterSpacing:"0.1em"}}>⚠ PAPER TRADING ONLY — NO REAL MONEY — SIMULATION</span>
      </footer>
    </div>
  );
}
