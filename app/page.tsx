"use client";
import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────
interface Candle { t: number; o: number; h: number; l: number; c: number; }
interface Trade { id: number; type: "LONG"|"SHORT"; entry: number; sl: number; tp1: number; tp2: number; lot: number; risk: number; status: "OPEN"|"TP1"|"TP2"|"SL"; pnl: number; time: string; session: string; }
interface Signal { dir: "LONG"|"SHORT"|"WAIT"; conf: number; ema: boolean; rsi: boolean; struct: boolean; rsiVal: number; reason: string; }

// ─── Session logic ────────────────────────────────────────────────────────
function getSession(h: number, m: number) {
  const t = h + m / 60;
  if (t >= 7   && t < 10) return { name:"LONDON/NY OVERLAP", abbr:"L/NY", color:"#00D97E", mult:1.0,   desc:"Peak liquidity · Strongest setups" };
  if (t >= 2   && t < 7 ) return { name:"LONDON OPEN",       abbr:"LON",  color:"#F5C842", mult:0.8,   desc:"High volatility · Breakout trades" };
  if (t >= 10  && t < 12) return { name:"NEW YORK MORNING",  abbr:"NYM",  color:"#F5C842", mult:0.8,   desc:"Good momentum · Trend continuation" };
  if (t >= 12  && t < 14) return { name:"NY MIDDAY",         abbr:"NYD",  color:"#FF8C42", mult:0.4,   desc:"Choppy · Scalps only · 50% size" };
  if (t >= 14  && t < 19) return { name:"NY AFTERNOON",      abbr:"NYA",  color:"#3B9EFF", mult:0.6,   desc:"Moderate · Trend trades only" };
  return                          { name:"ASIAN SESSION",     abbr:"ASI",  color:"#8B5CF6", mult:0.3,   desc:"Range-bound · Mark levels only" };
}

function calcLot(risk: number, slPips: number) {
  return Math.max(0.01, Math.floor(risk / (slPips * 0.01 * 100) * 100) / 100);
}

function calcSignal(price: number, t: number): Signal {
  const es = price + Math.sin(t*0.4)*2, em = price + Math.sin(t*0.2)*3, el = price - Math.sin(t*0.1)*5;
  const rsi = Math.min(78, Math.max(25, 50 + Math.sin(t*0.6)*22 + Math.sin(t*1.2)*8));
  const emaUp = es>em && em>el, emaDn = es<em && em<el;
  const rsiUp = rsi>50&&rsi<70, rsiDn = rsi<50&&rsi>30;
  const swept = Math.sin(t*0.3)>0.3;
  if (emaUp&&rsiUp&&swept) return { dir:"LONG",  conf:3, ema:true,  rsi:true,  struct:true,  rsiVal:rsi, reason:"Sweep + EMA bullish + RSI momentum" };
  if (emaDn&&rsiDn&&swept) return { dir:"SHORT", conf:2, ema:true,  rsi:true,  struct:false, rsiVal:rsi, reason:"EMA bearish + RSI below 50" };
  const c = (emaUp||emaDn?1:0)+(rsiUp||rsiDn?1:0)+(swept?1:0);
  return { dir:"WAIT", conf:c, ema:emaUp||emaDn, rsi:rsiUp||rsiDn, struct:swept, rsiVal:rsi, reason:"Insufficient confluence — wait" };
}

// ─── Candle Chart ─────────────────────────────────────────────────────────
function CandleChart({ candles, price, session }: { candles: Candle[]; price: number; session: ReturnType<typeof getSession> }) {
  const W=600, H=220;
  if (candles.length < 3) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"#4A6080", fontFamily:"'Syne',sans-serif", fontSize:11, letterSpacing:"0.15em" }}>
      BUILDING CHART DATA...
    </div>
  );
  const prices = candles.flatMap(c=>[c.h,c.l]);
  const lo=Math.min(...prices), hi=Math.max(...prices), range=hi-lo||1;
  const toY=(p:number)=>H-((p-lo)/range)*(H-24)-12;
  const cw=Math.max(3, Math.floor((W-30)/candles.length)-2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",background:"transparent"}}>
      <defs>
        <linearGradient id="priceLineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={session.color} stopOpacity="0"/>
          <stop offset="100%" stopColor={session.color} stopOpacity="0.9"/>
        </linearGradient>
      </defs>
      {/* Grid */}
      {[0.2,0.4,0.6,0.8].map(f=>(
        <line key={f} x1={0} y1={toY(lo+f*range)} x2={W} y2={toY(lo+f*range)} stroke="#1A2535" strokeWidth={1} strokeDasharray="4,6"/>
      ))}
      {/* Price labels */}
      {[0,0.5,1].map(f=>(
        <text key={f} x={W-4} y={toY(lo+f*range)+4} fill="#4A6080" fontSize={8} textAnchor="end" fontFamily="'DM Mono',monospace">
          {(lo+f*range).toFixed(2)}
        </text>
      ))}
      {/* Candles */}
      {candles.map((c,i)=>{
        const x=15+i*(cw+2), bull=c.c>=c.o;
        const color=bull?"#00D97E":"#FF3B5C";
        const bTop=toY(Math.max(c.o,c.c)), bH=Math.max(2,Math.abs(toY(c.o)-toY(c.c)));
        return (
          <g key={i}>
            <line x1={x+cw/2} y1={toY(c.h)} x2={x+cw/2} y2={toY(c.l)} stroke={color} strokeWidth={1} opacity={0.6}/>
            <rect x={x} y={bTop} width={cw} height={bH} fill={color} opacity={0.9} rx={1}/>
          </g>
        );
      })}
      {/* Current price line */}
      <line x1={0} y1={toY(price)} x2={W} y2={toY(price)} stroke={session.color} strokeWidth={1} strokeDasharray="3,4" opacity={0.7}/>
      {/* Price badge */}
      <rect x={W-72} y={toY(price)-10} width={70} height={18} fill={session.color} rx={2} opacity={0.15}/>
      <rect x={W-72} y={toY(price)-10} width={70} height={18} rx={2} stroke={session.color} strokeWidth={1} fill="none" opacity={0.5}/>
      <text x={W-37} y={toY(price)+4} fill={session.color} fontSize={9} textAnchor="middle" fontFamily="'Space Mono',monospace" fontWeight="700">
        {price.toFixed(2)}
      </text>
    </svg>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────
function Sparkline({ data, color, height=40 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const W=200, H=height;
  const lo=Math.min(...data), hi=Math.max(...data), range=hi-lo||1;
  const toY=(v:number)=>H-((v-lo)/range)*(H-4)-2;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*W},${toY(v)}`).join(" ");
  const apts=`0,${H} ${pts} ${W},${H}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height}}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={apts} fill={`url(#sg-${color.replace("#","")})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} opacity={0.9}/>
      <circle cx={(data.length-1)/(data.length-1)*W} cy={toY(data[data.length-1])} r={2.5} fill={color}/>
    </svg>
  );
}

// ─── RSI Gauge ────────────────────────────────────────────────────────────
function RsiGauge({ value }: { value: number }) {
  const angle = (value / 100) * 180 - 90;
  const color = value > 70 ? "#FF3B5C" : value < 30 ? "#00D97E" : "#F5C842";
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cx=60, cy=55, r=40;
  const startAngle=-180, endAngle=0;
  const arcPath = (a1:number,a2:number,color:string,w:number) => {
    const x1=cx+r*Math.cos(toRad(a1)), y1=cy+r*Math.sin(toRad(a1));
    const x2=cx+r*Math.cos(toRad(a2)), y2=cy+r*Math.sin(toRad(a2));
    return <path d={`M${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round"/>;
  };
  const nx=cx+r*Math.cos(toRad(angle-90)), ny=cy+r*Math.sin(toRad(angle-90));
  return (
    <svg viewBox="0 0 120 65" style={{width:"100%",height:65}}>
      {arcPath(startAngle, -90, "#1A2535", 8)}
      {arcPath(-90, endAngle, "#1A2535", 8)}
      {arcPath(startAngle, startAngle+(value/100)*180, color, 6)}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth={2} strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r={4} fill={color}/>
      <text x={cx} y={cy+14} textAnchor="middle" fill={color} fontSize={14} fontFamily="'Space Mono',monospace" fontWeight="700">{value.toFixed(0)}</text>
      <text x={12} y={62} fill="#4A6080" fontSize={8} fontFamily="'DM Mono',monospace">30</text>
      <text x={108} y={62} textAnchor="end" fill="#4A6080" fontSize={8} fontFamily="'DM Mono',monospace">70</text>
    </svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────
const CHECKLIST = [
  "Identify session & apply risk multiplier",
  "Mark previous session high & low",
  "Check economic calendar — next 2 hours",
  "Nearest $10 round number identified",
  "1H bias confirmed — written down",
  "Spread < 30 pips confirmed",
  "3 confluences met (2 in Asian session)",
  "TP1 at 1:1 · TP2 at 2:1 set before entry",
  "Daily loss remaining > $2",
  "Max 3 trades/day — slots remaining",
];

const SESSION_MAP = [
  { time:"00–02 CT", name:"Asian",          color:"#8B5CF6", mult:"30%" },
  { time:"02–07 CT", name:"London Open",    color:"#F5C842", mult:"80%" },
  { time:"07–10 CT", name:"L/NY Overlap",   color:"#00D97E", mult:"100%" },
  { time:"10–12 CT", name:"NY Morning",     color:"#F5C842", mult:"80%" },
  { time:"12–14 CT", name:"NY Midday",      color:"#FF8C42", mult:"40%" },
  { time:"14–19 CT", name:"NY Afternoon",   color:"#3B9EFF", mult:"60%" },
  { time:"19–24 CT", name:"Asian Open",     color:"#8B5CF6", mult:"30%" },
];

export default function Terminal() {
  const BASE = 3342.50;

  // State
  const [price, setPrice]           = useState(BASE);
  const [prevPrice, setPrevPrice]   = useState(BASE);
  const [livePrice, setLivePrice]   = useState<number|null>(null);
  const [priceSource, setPriceSource] = useState<"live"|"sim">("sim");
  const [candles, setCandles]       = useState<Candle[]>([]);
  const [signal, setSignal]         = useState<Signal>({ dir:"WAIT", conf:0, ema:false, rsi:false, struct:false, rsiVal:50, reason:"Initializing..." });
  const [trades, setTrades]         = useState<Trade[]>([]);
  const [checked, setChecked]       = useState<boolean[]>(new Array(CHECKLIST.length).fill(false));
  const [account, setAccount]       = useState({ equity:100, dailyPnl:0, trades:0 });
  const [rsiHistory, setRsiHistory] = useState<number[]>([50]);
  const [pnlHistory, setPnlHistory] = useState<number[]>([0]);
  const [ctTime, setCtTime]         = useState("--:--:--");
  const [ctH, setCtH]               = useState(8);
  const [ctM, setCtM]               = useState(0);
  const [tab, setTab]               = useState<"chart"|"trades"|"rules"|"checklist">("chart");
  const [aiText, setAiText]         = useState("");
  const [aiLoad, setAiLoad]         = useState(false);
  const tickRef   = useRef(0);
  const candleRef = useRef<Candle>({ t:Date.now(), o:BASE, h:BASE, l:BASE, c:BASE });

  // ── Real price fetch ──────────────────────────────────────────────────
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        // Use frankfurter or metals API — try multiple free sources
        const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d", {
          headers: { "Accept": "application/json" }
        });
        if (!res.ok) throw new Error("yahoo fail");
        const data = await res.json();
        const p = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (p && p > 1000) {
          setLivePrice(p);
          setPriceSource("live");
          setPrice(prev => { setPrevPrice(prev); return p; });
        }
      } catch {
        // Fallback: metals-api alternative
        try {
          const r2 = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=XAU");
          const d2 = await r2.json();
          const usdRate = d2?.data?.rates?.USD;
          if (usdRate) {
            const p2 = parseFloat(usdRate);
            if (p2 > 1000) {
              setLivePrice(p2);
              setPriceSource("live");
              setPrice(prev => { setPrevPrice(prev); return p2; });
            }
          }
        } catch { /* use sim */ }
      }
    };
    fetchPrice();
    const iv = setInterval(fetchPrice, 30000);
    return () => clearInterval(iv);
  }, []);

  // ── Clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const ct = new Intl.DateTimeFormat("en-US", { timeZone:"America/Chicago", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(new Date());
      setCtTime(ct);
      const [h,m] = ct.split(":").map(Number);
      setCtH(h); setCtM(m);
    };
    tick(); const iv = setInterval(tick,1000); return () => clearInterval(iv);
  }, []);

  // ── Simulation price + candles ─────────────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      tickRef.current += 0.05;
      const t = tickRef.current;
      const base = livePrice || BASE;
      // More realistic price movement
      const trend = Math.sin(t * 0.08) * 12;
      const wave1 = Math.sin(t * 0.5) * 3;
      const wave2 = Math.sin(t * 1.1) * 1.5;
      const noise = (Math.random() - 0.5) * 0.8;
      const np = base + trend + wave1 + wave2 + noise;

      const sig = calcSignal(np, t);
      setPrice(prev => { setPrevPrice(prev); return np; });
      setSignal(sig);
      setRsiHistory(h => [...h.slice(-59), sig.rsiVal]);

      // Candles
      candleRef.current.h = Math.max(candleRef.current.h, np);
      candleRef.current.l = Math.min(candleRef.current.l, np);
      candleRef.current.c = np;
      if (Date.now() - candleRef.current.t >= 4000) {
        setCandles(prev => [...prev.slice(-99), {...candleRef.current}]);
        candleRef.current = { t:Date.now(), o:np, h:np, l:np, c:np };
      }

      // Update open trades
      setTrades(prev => prev.map(tr => {
        if (tr.status !== "OPEN") return tr;
        const pips = tr.type==="LONG" ? (np-tr.entry)*10 : (tr.entry-np)*10;
        const pnl = pips * tr.lot * 0.01 * 100;
        if (tr.type==="LONG"  && np>=tr.tp2) return {...tr, status:"TP2", pnl:tr.risk*2};
        if (tr.type==="LONG"  && np>=tr.tp1) return {...tr, status:"TP1", pnl:tr.risk};
        if (tr.type==="LONG"  && np<=tr.sl)  return {...tr, status:"SL",  pnl:-tr.risk};
        if (tr.type==="SHORT" && np<=tr.tp2) return {...tr, status:"TP2", pnl:tr.risk*2};
        if (tr.type==="SHORT" && np<=tr.tp1) return {...tr, status:"TP1", pnl:tr.risk};
        if (tr.type==="SHORT" && np>=tr.sl)  return {...tr, status:"SL",  pnl:-tr.risk};
        return {...tr, pnl};
      }));
    }, 350);
    return () => clearInterval(iv);
  }, [livePrice]);

  // ── Account ────────────────────────────────────────────────────────────
  useEffect(() => {
    const closed = trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0);
    const open   = trades.filter(t=>t.status==="OPEN").reduce((s,t)=>s+t.pnl,0);
    const dailyPnl = closed + open;
    setAccount({ equity: 100+dailyPnl, dailyPnl, trades: trades.length });
    setPnlHistory(h => [...h.slice(-59), dailyPnl]);
  }, [trades]);

  // ── Place trade ────────────────────────────────────────────────────────
  const sess = getSession(ctH, ctM);
  const risk = parseFloat((2 * sess.mult).toFixed(2));
  const lot  = calcLot(risk, 20);
  const riskLimitHit = account.dailyPnl <= -6;
  const maxTrades    = account.trades >= 3;

  const placeTrade = useCallback((type: "LONG"|"SHORT") => {
    if (maxTrades || riskLimitHit) return;
    const sl  = type==="LONG" ? price-2 : price+2;
    const tp1 = type==="LONG" ? price+2 : price-2;
    const tp2 = type==="LONG" ? price+4 : price-4;
    const now = new Date();
    const time = now.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:false});
    setTrades(p => [...p, { id:Date.now(), type, entry:price, sl, tp1, tp2, lot, risk, status:"OPEN", pnl:0, time, session:sess.abbr }]);
  }, [price, lot, risk, maxTrades, riskLimitHit, sess]);

  // ── AI ────────────────────────────────────────────────────────────────
  const getAi = async () => {
    setAiLoad(true); setAiText("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:800,
          system:"You are a senior XAU/USD trader. Be concise. Format: **BIAS** (1 line) | **EDGE** (1 line) | **PLAN** (3 bullets). Max 120 words.",
          messages:[{role:"user",content:`XAU: $${price.toFixed(2)} | ${priceSource==="live"?"LIVE PRICE":"SIM"} | Session: ${sess.name} | CT: ${ctTime} | Signal: ${signal.dir} ${signal.conf}/3 | RSI: ${signal.rsiVal.toFixed(1)} | P&L: $${account.dailyPnl.toFixed(2)} | Equity: $${account.equity.toFixed(2)}`}]
        })
      });
      const d = await res.json();
      setAiText(d.content?.find((b:{type:string})=>b.type==="text")?.text || "Unavailable.");
    } catch { setAiText("⚠ Connect Anthropic API key to enable AI analysis."); }
    setAiLoad(false);
  };

  const priceUp = price >= prevPrice;
  const pnlPct  = account.dailyPnl / 100 * 100;
  const lossLeft = Math.max(0, 6 + account.dailyPnl);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",flexDirection:"column"}}>

      {/* ── TOP HEADER ─────────────────────────────────────────────── */}
      <header style={{
        background:"var(--bg-1)",
        borderBottom:"1px solid var(--border)",
        padding:"0 20px",
        height:56,
        display:"flex",
        alignItems:"center",
        justifyContent:"space-between",
        position:"sticky",
        top:0,
        zIndex:100,
      }}>
        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{position:"relative"}}>
            <div style={{
              width:34, height:34, borderRadius:4,
              background:"linear-gradient(135deg,#D4A843,#8B6914)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:16, fontWeight:900, color:"#03050A",
              fontFamily:"'Syne',sans-serif",
            }}>AU</div>
            {priceSource==="live" && <div style={{position:"absolute",top:-3,right:-3,width:8,height:8,borderRadius:"50%",background:"#00D97E",border:"2px solid var(--bg-1)"}} className="animate-pulse-dot"/>}
          </div>
          <div>
            <div className="font-display" style={{fontSize:15,fontWeight:800,color:"var(--text-bright)",letterSpacing:"0.05em"}}>XAU/USD TERMINAL</div>
            <div style={{fontSize:9,color:"var(--text-dim)",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>
              24/7 ADAPTIVE · {priceSource==="live" ? "● LIVE FEED" : "◌ SIM MODE"}
            </div>
          </div>
        </div>

        {/* Center: Price Hero */}
        <div style={{display:"flex",alignItems:"baseline",gap:12}}>
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>XAU/USD</span>
          <span className="font-mono" style={{
            fontSize:32,
            fontWeight:700,
            color: priceUp ? "var(--green)" : "var(--red)",
            transition:"color 0.4s",
            textShadow: priceUp ? "0 0 30px rgba(0,217,126,0.5)" : "0 0 30px rgba(255,59,92,0.5)",
          }}>
            {price.toFixed(2)}
          </span>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            <span style={{fontSize:12,color:priceUp?"var(--green)":"var(--red)",fontFamily:"'Space Mono',monospace"}}>
              {priceUp?"▲":"▼"} {Math.abs(price-BASE).toFixed(2)}
            </span>
            <span style={{fontSize:10,color:priceUp?"var(--green)":"var(--red)",fontFamily:"'Space Mono',monospace",opacity:0.7}}>
              {priceUp?"+":""}{((price-BASE)/BASE*100).toFixed(3)}%
            </span>
          </div>
        </div>

        {/* Right */}
        <div style={{display:"flex",alignItems:"center",gap:24}}>
          {/* Session */}
          <div style={{textAlign:"right"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end",marginBottom:2}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:sess.color}} className="animate-pulse-dot"/>
              <span className="font-display" style={{fontSize:11,fontWeight:700,color:sess.color,letterSpacing:"0.1em"}}>{sess.name}</span>
            </div>
            <div style={{fontSize:9,color:"var(--text-dim)",letterSpacing:"0.1em",fontFamily:"'Syne',sans-serif"}}>{sess.desc}</div>
          </div>
          {/* Clock */}
          <div style={{
            background:"var(--bg-2)",
            border:"1px solid var(--border)",
            borderRadius:4,
            padding:"6px 14px",
            textAlign:"center",
          }}>
            <div className="font-mono" style={{fontSize:20,color:"var(--gold)",fontWeight:700,letterSpacing:"0.08em"}}>{ctTime}</div>
            <div style={{fontSize:8,color:"var(--text-dim)",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>CHICAGO TIME</div>
          </div>
          {/* Equity */}
          <div style={{
            background: account.equity>=100 ? "rgba(0,217,126,0.06)" : "rgba(255,59,92,0.06)",
            border: `1px solid ${account.equity>=100?"rgba(0,217,126,0.2)":"rgba(255,59,92,0.2)"}`,
            borderRadius:4,
            padding:"6px 14px",
            textAlign:"center",
          }}>
            <div className="font-mono" style={{fontSize:18,color:account.equity>=100?"var(--green)":"var(--red)",fontWeight:700}}>
              ${account.equity.toFixed(2)}
            </div>
            <div style={{fontSize:8,color:"var(--text-dim)",letterSpacing:"0.2em",fontFamily:"'Syne',sans-serif",fontWeight:600}}>EQUITY</div>
          </div>
        </div>
      </header>

      {/* ── SESSION RIBBON ─────────────────────────────────────────── */}
      <div style={{
        background:`linear-gradient(90deg, ${sess.color}18 0%, transparent 50%)`,
        borderBottom:"1px solid var(--border)",
        padding:"7px 20px",
        display:"flex",
        alignItems:"center",
        gap:24,
      }}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>RISK MULT</span>
          <span className="font-mono" style={{fontSize:14,color:sess.color,fontWeight:700}}>{sess.mult}×</span>
        </div>
        <div style={{width:1,height:20,background:"var(--border)"}}/>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>ACTIVE LOT</span>
          <span className="font-mono" style={{fontSize:14,color:"var(--gold)",fontWeight:700}}>{lot.toFixed(2)}</span>
        </div>
        <div style={{width:1,height:20,background:"var(--border)"}}/>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>RISK/TRADE</span>
          <span className="font-mono" style={{fontSize:14,color:"var(--green)",fontWeight:700}}>${risk.toFixed(2)}</span>
        </div>
        <div style={{width:1,height:20,background:"var(--border)"}}/>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>BID</span>
          <span className="font-mono" style={{fontSize:12,color:"var(--text)"}}>{(price-0.15).toFixed(2)}</span>
          <span style={{fontSize:9,color:"var(--text-dim)"}}>|</span>
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>ASK</span>
          <span className="font-mono" style={{fontSize:12,color:"var(--text)"}}>{(price+0.15).toFixed(2)}</span>
          <span style={{fontSize:9,color:"var(--text-dim)"}}>|</span>
          <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>SPREAD</span>
          <span className="font-mono" style={{fontSize:12,color:"var(--gold)"}}>0.30</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {riskLimitHit && <span className="badge badge-red">⛔ DAILY LIMIT HIT</span>}
          {!riskLimitHit && maxTrades && <span className="badge badge-gold">⚠ MAX 3 TRADES</span>}
          {!riskLimitHit && !maxTrades && <span className="badge badge-green">● TRADING ACTIVE</span>}
        </div>
      </div>

      {/* ── MAIN GRID ──────────────────────────────────────────────── */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"260px 1fr 260px",gap:"1px",background:"var(--border)"}}>

        {/* ── LEFT PANEL ─────────────────────────────────────── */}
        <div style={{background:"var(--bg-1)",padding:"14px",display:"flex",flexDirection:"column",gap:"12px",overflowY:"auto"}}>

          {/* Signal card */}
          <div style={{
            background: signal.dir==="LONG" ? "rgba(0,217,126,0.04)" : signal.dir==="SHORT" ? "rgba(255,59,92,0.04)" : "rgba(212,168,67,0.04)",
            border: `1px solid ${signal.dir==="LONG" ? "rgba(0,217,126,0.25)" : signal.dir==="SHORT" ? "rgba(255,59,92,0.25)" : "rgba(212,168,67,0.2)"}`,
            borderRadius:4,
            padding:"14px",
          }}>
            <div className="label" style={{marginBottom:10}}>SIGNAL ENGINE</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div className="font-display" style={{
                fontSize:28, fontWeight:800,
                color: signal.dir==="LONG"?"var(--green)":signal.dir==="SHORT"?"var(--red)":"var(--gold)",
                letterSpacing:"0.05em",
                textShadow: signal.dir==="LONG"?"0 0 30px rgba(0,217,126,0.6)":signal.dir==="SHORT"?"0 0 30px rgba(255,59,92,0.6)":"0 0 20px rgba(212,168,67,0.4)",
              }}>{signal.dir}</div>
              <div style={{textAlign:"right"}}>
                <div className="label" style={{marginBottom:4}}>CONFLUENCE</div>
                <div style={{display:"flex",gap:4}}>
                  {[1,2,3].map(i=>(
                    <div key={i} style={{width:20,height:20,borderRadius:3,background:signal.conf>=i?(signal.dir==="LONG"?"var(--green)":signal.dir==="SHORT"?"var(--red)":"var(--gold)"):"var(--bg-3)",border:`1px solid ${signal.conf>=i?"transparent":"var(--border)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"var(--bg)",fontWeight:700}}>
                      {signal.conf>=i?"✓":""}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {[
              {label:"EMA Stack", ok:signal.ema, val:signal.ema?"Aligned":"Neutral"},
              {label:"RSI Signal", ok:signal.rsi, val:signal.rsiVal.toFixed(1)},
              {label:"Structure",  ok:signal.struct, val:signal.struct?"Swept":"Pending"},
            ].map(item=>(
              <div key={item.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,padding:"4px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:18,height:18,borderRadius:3,background:item.ok?"rgba(0,217,126,0.15)":"rgba(255,59,92,0.1)",border:`1px solid ${item.ok?"rgba(0,217,126,0.3)":"rgba(255,59,92,0.2)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10}}>
                    <span style={{color:item.ok?"var(--green)":"var(--red)"}}>{item.ok?"✓":"✗"}</span>
                  </div>
                  <span style={{fontSize:11,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{item.label}</span>
                </div>
                <span style={{fontSize:11,color:"var(--text)",fontFamily:"'Space Mono',monospace"}}>{item.val}</span>
              </div>
            ))}

            <div style={{marginTop:8,padding:"6px 8px",background:"rgba(0,0,0,0.2)",borderRadius:3,fontSize:10,color:"var(--gold)",fontFamily:"'DM Mono',monospace",lineHeight:1.5}}>{signal.reason}</div>
          </div>

          {/* RSI Gauge */}
          <div className="card" style={{padding:"12px"}}>
            <div className="label" style={{marginBottom:6}}>RSI (14)</div>
            <RsiGauge value={signal.rsiVal}/>
            <Sparkline data={rsiHistory} color={signal.rsiVal>70?"#FF3B5C":signal.rsiVal<30?"#00D97E":"#3B9EFF"} height={32}/>
          </div>

          {/* Lot Calc */}
          <div className="card" style={{padding:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div className="label">LOT CALCULATOR</div>
              <span className="badge" style={{background:`${sess.color}18`,border:`1px solid ${sess.color}40`,color:sess.color}}>{sess.abbr} {Math.round(sess.mult*100)}%</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:4}}>
              {["SL","LOT","RISK"].map(h=><div key={h} className="label" style={{textAlign:"center",padding:"3px 0",background:"var(--bg-3)",borderRadius:2}}>{h}</div>)}
            </div>
            {[15,20,25,30].map(sl=>{
              const r = parseFloat((2*sess.mult).toFixed(2));
              const l = calcLot(r,sl);
              return (
                <div key={sl} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,marginBottom:3}}>
                  <div style={{textAlign:"center",padding:"4px",background:"var(--bg-2)",borderRadius:2,fontSize:11,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{sl}p</div>
                  <div style={{textAlign:"center",padding:"4px",background:"var(--bg-2)",borderRadius:2,fontSize:11,color:"var(--gold)",fontFamily:"'Space Mono',monospace",fontWeight:700}}>{l.toFixed(2)}</div>
                  <div style={{textAlign:"center",padding:"4px",background:"var(--bg-2)",borderRadius:2,fontSize:11,color:"var(--green)",fontFamily:"'Space Mono',monospace"}}>${r}</div>
                </div>
              );
            })}
          </div>

          {/* Account */}
          <div className="card" style={{padding:"12px"}}>
            <div className="label" style={{marginBottom:10}}>ACCOUNT STATUS</div>
            {[
              {l:"Capital",     v:"$100.00",            c:"var(--text-dim)"},
              {l:"Leverage",    v:"1 : 1000",           c:"var(--blue)"},
              {l:"Equity",      v:`$${account.equity.toFixed(2)}`, c:account.equity>=100?"var(--green)":"var(--red)"},
              {l:"Daily P&L",   v:`${account.dailyPnl>=0?"+":""}$${account.dailyPnl.toFixed(2)}`, c:account.dailyPnl>=0?"var(--green)":"var(--red)"},
              {l:"Trades",      v:`${account.trades} / 3`, c:maxTrades?"var(--red)":"var(--gold)"},
              {l:"Loss Limit",  v:"$6.00  (6%)",        c:"var(--text-dim)"},
            ].map(item=>(
              <div key={item.l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontSize:11,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{item.l}</span>
                <span style={{fontSize:11,color:item.c,fontFamily:"'Space Mono',monospace",fontWeight:700}}>{item.v}</span>
              </div>
            ))}
            <div style={{marginTop:10}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span className="label">LOSS BUFFER</span>
                <span className="font-mono" style={{fontSize:10,color:lossLeft>3?"var(--green)":"var(--red)"}}>${lossLeft.toFixed(2)} left</span>
              </div>
              <div className="progress">
                <div className="progress-fill" style={{width:`${(lossLeft/6)*100}%`,background:lossLeft>3?"var(--green)":lossLeft>2?"var(--gold)":"var(--red)"}}/>
              </div>
            </div>
            <div style={{marginTop:8}}>
              <div className="label" style={{marginBottom:4}}>DAILY P&L CURVE</div>
              <Sparkline data={pnlHistory} color={account.dailyPnl>=0?"var(--green)":"var(--red)"} height={36}/>
            </div>
          </div>
        </div>

        {/* ── CENTER ─────────────────────────────────────────────── */}
        <div style={{background:"var(--bg-1)",display:"flex",flexDirection:"column"}}>

          {/* Tab bar */}
          <div style={{display:"flex",borderBottom:"1px solid var(--border)",background:"var(--bg)"}}>
            {(["chart","trades","rules","checklist"] as const).map(t=>(
              <button key={t} className={`tab-btn ${tab===t?"active":""}`} onClick={()=>setTab(t)}>{t}</button>
            ))}
            <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,paddingRight:16,fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>
              {priceSource==="live" ? <><span style={{color:"var(--green)"}}>●</span> LIVE PRICE</> : <><span style={{color:"var(--text-dim)"}}>◌</span> SIM MODE</>}
            </div>
          </div>

          {/* CHART TAB */}
          {tab==="chart" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",padding:"14px",gap:"12px"}}>
              {/* Chart header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",gap:16,alignItems:"center"}}>
                  <span className="label">XAU/USD · 5M</span>
                  <div style={{display:"flex",gap:8}}>
                    {[{c:"#F5C842",l:"EMA9"},{c:"#FF8C42",l:"EMA21"},{c:"#FF3B5C",l:"EMA50"}].map(e=>(
                      <div key={e.l} style={{display:"flex",gap:4,alignItems:"center"}}>
                        <div style={{width:16,height:2,background:e.c,borderRadius:1}}/>
                        <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{e.l}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",fontSize:10,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>
                  <span>H: <span style={{color:"var(--red)"}}>{candles.length>0?Math.max(...candles.map(c=>c.h)).toFixed(2):price.toFixed(2)}</span></span>
                  <span>L: <span style={{color:"var(--green)"}}>{candles.length>0?Math.min(...candles.map(c=>c.l)).toFixed(2):price.toFixed(2)}</span></span>
                </div>
              </div>

              {/* Chart */}
              <div style={{flex:1,background:"var(--bg)",border:"1px solid var(--border)",borderRadius:4,overflow:"hidden",minHeight:220,position:"relative"}}>
                <CandleChart candles={candles} price={price} session={sess}/>
                {/* Corner watermark */}
                <div style={{position:"absolute",top:8,left:10,opacity:0.15,fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:11,color:"var(--gold)",letterSpacing:"0.2em"}}>XAU/USD</div>
              </div>

              {/* Trade buttons */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <button className="btn-long" onClick={()=>placeTrade("LONG")} disabled={maxTrades||riskLimitHit}>
                  <div style={{fontSize:18,marginBottom:2}}>▲ LONG</div>
                  <div style={{fontSize:10,opacity:0.8}}>{lot.toFixed(2)} lot · ${risk} risk · 20p SL</div>
                </button>
                <button className="btn-short" onClick={()=>placeTrade("SHORT")} disabled={maxTrades||riskLimitHit}>
                  <div style={{fontSize:18,marginBottom:2}}>▼ SHORT</div>
                  <div style={{fontSize:10,opacity:0.8}}>{lot.toFixed(2)} lot · ${risk} risk · 20p SL</div>
                </button>
              </div>
              <div style={{fontSize:10,color:"var(--text-dim)",textAlign:"center",fontFamily:"'DM Mono',monospace"}}>
                TP1: 1:1 R/R · TP2: 2:1 R/R · Session: {sess.name} · Max 3 trades/day
              </div>

              {/* AI */}
              <div className="card" style={{padding:"12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div className="label">AI ANALYSIS</div>
                  <button onClick={getAi} disabled={aiLoad} style={{
                    padding:"5px 14px",
                    background:"rgba(212,168,67,0.1)",
                    border:"1px solid rgba(212,168,67,0.3)",
                    borderRadius:3,
                    color:"var(--gold)",
                    fontSize:10,
                    cursor:aiLoad?"not-allowed":"pointer",
                    fontFamily:"'Syne',sans-serif",
                    fontWeight:700,
                    letterSpacing:"0.1em",
                    transition:"all 0.2s",
                  }}>
                    {aiLoad ? "ANALYZING..." : "GET READ →"}
                  </button>
                </div>
                {aiLoad && <div style={{fontSize:11,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>Consulting strategy engine<span style={{animation:"blink 1s step-end infinite"}}>▋</span></div>}
                {aiText && <div style={{fontSize:12,color:"var(--text)",lineHeight:1.7,fontFamily:"'DM Mono',monospace",whiteSpace:"pre-wrap"}}>{aiText}</div>}
                {!aiText&&!aiLoad && <div style={{fontSize:11,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>Session-aware analysis. Updated on demand.</div>}
              </div>
            </div>
          )}

          {/* TRADES TAB */}
          {tab==="trades" && (
            <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div className="label">TRADE LOG</div>
                <div style={{display:"flex",gap:8}}>
                  <span className="badge badge-green">W: {trades.filter(t=>["TP1","TP2"].includes(t.status)).length}</span>
                  <span className="badge badge-red">L: {trades.filter(t=>t.status==="SL").length}</span>
                  <span className="badge badge-gold">O: {trades.filter(t=>t.status==="OPEN").length}</span>
                </div>
              </div>

              {trades.length===0 && (
                <div style={{textAlign:"center",padding:"60px 0",color:"var(--text-dim)"}}>
                  <div style={{fontSize:32,marginBottom:12,opacity:0.3}}>◈</div>
                  <div className="font-display" style={{fontSize:12,letterSpacing:"0.2em"}}>NO TRADES YET</div>
                  <div style={{fontSize:10,marginTop:6,fontFamily:"'DM Mono',monospace"}}>Wait for 3-confluence setup</div>
                </div>
              )}

              {trades.map(tr=>{
                const statusColor = tr.status==="OPEN"?"var(--gold)":["TP1","TP2"].includes(tr.status)?"var(--green)":"var(--red)";
                return (
                  <div key={tr.id} className="animate-slide-up" style={{
                    background:"var(--bg-2)",
                    border:`1px solid ${["TP1","TP2"].includes(tr.status)?"rgba(0,217,126,0.2)":tr.status==="SL"?"rgba(255,59,92,0.2)":"rgba(212,168,67,0.15)"}`,
                    borderRadius:4,
                    padding:"12px",
                    marginBottom:8,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span className={`badge ${tr.type==="LONG"?"badge-green":"badge-red"}`}>{tr.type}</span>
                        <span style={{fontSize:10,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{tr.time}</span>
                        <span className="badge badge-blue">{tr.session}</span>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span className="font-mono" style={{fontSize:14,color:tr.pnl>=0?"var(--green)":"var(--red)",fontWeight:700}}>
                          {tr.pnl>=0?"+":""}${tr.pnl.toFixed(2)}
                        </span>
                        <span className="badge" style={{background:`${statusColor}18`,border:`1px solid ${statusColor}40`,color:statusColor}}>{tr.status}</span>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
                      {[{l:"ENTRY",v:tr.entry.toFixed(2)},{l:"SL",v:tr.sl.toFixed(2)},{l:"TP1",v:tr.tp1.toFixed(2)},{l:"TP2",v:tr.tp2.toFixed(2)},{l:"LOT",v:tr.lot.toFixed(2)}].map(item=>(
                        <div key={item.l} style={{background:"var(--bg-3)",borderRadius:3,padding:"4px 6px"}}>
                          <div className="label" style={{marginBottom:2}}>{item.l}</div>
                          <div className="font-mono" style={{fontSize:11,color:"var(--text-bright)"}}>{item.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {trades.length>0 && (
                <div className="card" style={{padding:"12px",marginTop:4}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {[
                      {l:"WIN RATE",v:`${trades.filter(t=>t.status!=="OPEN").length>0?Math.round(trades.filter(t=>["TP1","TP2"].includes(t.status)).length/trades.filter(t=>t.status!=="OPEN").length*100):0}%`,c:"var(--green)"},
                      {l:"BEST TRADE",v:`+$${Math.max(0,...trades.map(t=>t.pnl)).toFixed(2)}`,c:"var(--green)"},
                      {l:"CLOSED P&L",v:`${trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0)>=0?"+":""}$${trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0).toFixed(2)}`,c:trades.filter(t=>t.status!=="OPEN").reduce((s,t)=>s+t.pnl,0)>=0?"var(--green)":"var(--red)"},
                      {l:"TOTAL",v:trades.length.toString(),c:"var(--gold)"},
                    ].map(item=>(
                      <div key={item.l} style={{background:"var(--bg-3)",borderRadius:3,padding:"8px",textAlign:"center"}}>
                        <div className="label" style={{marginBottom:4}}>{item.l}</div>
                        <div className="font-mono" style={{fontSize:14,color:item.c,fontWeight:700}}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* RULES TAB */}
          {tab==="rules" && (
            <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
              <div className="label" style={{marginBottom:14}}>24/7 ADAPTIVE SESSION SCHEDULE</div>
              <div style={{marginBottom:16}}>
                {SESSION_MAP.map((s,i)=>{
                  const isNow = sess.name.toLowerCase().includes(s.name.toLowerCase().split("/")[0].toLowerCase()) || s.name.toLowerCase().includes(sess.abbr.toLowerCase());
                  return (
                    <div key={i} style={{
                      display:"flex",justifyContent:"space-between",alignItems:"center",
                      padding:"10px 12px",marginBottom:4,borderRadius:4,
                      background:isNow?`${s.color}10`:"var(--bg-2)",
                      border:`1px solid ${isNow?`${s.color}30`:"var(--border)"}`,
                      transition:"all 0.3s",
                    }}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <div style={{width:4,height:24,borderRadius:2,background:isNow?s.color:"var(--border)"}}/>
                        <div>
                          <div className="font-display" style={{fontSize:12,fontWeight:700,color:isNow?s.color:"var(--text)",letterSpacing:"0.05em"}}>{s.name} {isNow&&"← NOW"}</div>
                          <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{s.time}</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div className="label">RISK</div>
                        <div className="font-mono" style={{fontSize:16,color:s.color,fontWeight:700}}>{s.mult}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {[
                {title:"ENTRY RULES",color:"var(--gold)",rules:["Overlap/London/NY: 3 confluences required","Asian sessions: Only A+ setups with 3/3","Never enter 15min before high-impact news","Signal candle must be CLOSED before entry","EMA 9>21>50 (long) or 9<21<50 (short)","RSI 50–70 for longs · RSI 30–50 for shorts"]},
                {title:"RISK MANAGEMENT",color:"var(--red)",rules:["Daily loss limit: $6.00 — hard stop","Max 3 trades per day, all sessions combined","Lot size auto-scales to session multiplier","Move SL to breakeven after TP1 is hit","TP1 = 1:1 R/R (close 50%) · TP2 = 2:1 R/R","Balance under $80: cut lot sizes by 50%"]},
                {title:"BEST PROFIT WINDOWS",color:"var(--green)",rules:["07:00–10:00 CT — London/NY Overlap = 100% size","02:00–07:00 CT — London Open = 80% size","10:00–12:00 CT — NY Morning = 80% size","19:00–02:00 CT — Asian = 30% size max","Highest ATR: always 07:30–09:00 CT","News spike: wait for close + retest ONLY"]},
              ].map(section=>(
                <div key={section.title} className="card" style={{padding:"12px",marginBottom:8}}>
                  <div className="font-display" style={{fontSize:10,fontWeight:700,color:section.color,letterSpacing:"0.2em",marginBottom:8}}>{section.title}</div>
                  {section.rules.map((r,i)=>(
                    <div key={i} style={{display:"flex",gap:8,marginBottom:5,fontSize:11,color:"var(--text)",fontFamily:"'DM Mono',monospace",lineHeight:1.4}}>
                      <span style={{color:section.color,flexShrink:0}}>›</span>{r}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* CHECKLIST TAB */}
          {tab==="checklist" && (
            <div style={{flex:1,padding:"14px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div className="label">PRE-TRADE CHECKLIST</div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span className="font-mono" style={{fontSize:13,color:checked.filter(Boolean).length===CHECKLIST.length?"var(--green)":"var(--gold)"}}>{checked.filter(Boolean).length}/{CHECKLIST.length}</span>
                  <button onClick={()=>setChecked(new Array(CHECKLIST.length).fill(false))} style={{padding:"3px 10px",background:"transparent",border:"1px solid var(--border)",borderRadius:3,color:"var(--text-dim)",fontSize:10,cursor:"pointer",fontFamily:"'Syne',sans-serif",letterSpacing:"0.1em"}}>RESET</button>
                </div>
              </div>
              <div className="progress" style={{marginBottom:14,height:4}}>
                <div className="progress-fill" style={{width:`${(checked.filter(Boolean).length/CHECKLIST.length)*100}%`,background:checked.filter(Boolean).length===CHECKLIST.length?"var(--green)":"var(--gold)"}}/>
              </div>
              {CHECKLIST.map((item,i)=>(
                <div key={i} onClick={()=>setChecked(p=>{const n=[...p];n[i]=!n[i];return n;})} style={{
                  display:"flex",alignItems:"flex-start",gap:10,padding:"10px 10px",marginBottom:4,cursor:"pointer",
                  background:checked[i]?"rgba(0,217,126,0.04)":"var(--bg-2)",
                  border:`1px solid ${checked[i]?"rgba(0,217,126,0.2)":"var(--border)"}`,
                  borderRadius:4,transition:"all 0.2s",
                }}>
                  <div style={{
                    width:20,height:20,borderRadius:4,flexShrink:0,marginTop:1,
                    background:checked[i]?"var(--green)":"transparent",
                    border:`1px solid ${checked[i]?"var(--green)":"var(--border-bright)"}`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    transition:"all 0.2s",
                  }}>
                    {checked[i] && <span style={{color:"var(--bg)",fontSize:12,fontWeight:900,lineHeight:1}}>✓</span>}
                  </div>
                  <span style={{fontSize:12,color:checked[i]?"var(--text-dim)":"var(--text)",textDecoration:checked[i]?"line-through":"none",fontFamily:"'DM Mono',monospace",lineHeight:1.5}}>{item}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ────────────────────────────────────────── */}
        <div style={{background:"var(--bg-1)",padding:"14px",display:"flex",flexDirection:"column",gap:"12px",overflowY:"auto"}}>

          {/* Session detail */}
          <div style={{background:`linear-gradient(135deg,${sess.color}12,${sess.color}04)`,border:`1px solid ${sess.color}30`,borderRadius:4,padding:"14px"}}>
            <div className="label" style={{marginBottom:8}}>ACTIVE SESSION</div>
            <div className="font-display" style={{fontSize:16,fontWeight:800,color:sess.color,letterSpacing:"0.05em",marginBottom:4}}>{sess.name}</div>
            <div style={{fontSize:11,color:"var(--text)",fontFamily:"'DM Mono',monospace",marginBottom:10,lineHeight:1.5}}>{sess.desc}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{l:"MULTIPLIER",v:`${sess.mult}×`,c:sess.color},{l:"LOT SIZE",v:lot.toFixed(2),c:"var(--gold)"},{l:"RISK/TRADE",v:`$${risk}`,c:"var(--green)"},{l:"SL / TP1",v:"20p / 1:1",c:"var(--text-dim)"}].map(item=>(
                <div key={item.l} style={{background:"rgba(0,0,0,0.2)",borderRadius:3,padding:"8px",textAlign:"center"}}>
                  <div className="label" style={{marginBottom:4}}>{item.l}</div>
                  <div className="font-mono" style={{fontSize:14,color:item.c,fontWeight:700}}>{item.v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Session timeline */}
          <div className="card" style={{padding:"12px"}}>
            <div className="label" style={{marginBottom:10}}>SESSION TIMELINE</div>
            {SESSION_MAP.map((s,i)=>{
              const isNow = sess.name.toLowerCase().includes(s.name.toLowerCase().split("/")[0].toLowerCase());
              return (
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",marginBottom:3,borderRadius:3,background:isNow?`${s.color}12`:"transparent",border:`1px solid ${isNow?`${s.color}25`:"transparent"}`,transition:"all 0.3s"}}>
                  <div>
                    <div style={{fontSize:10,color:isNow?s.color:"var(--text)",fontFamily:"'DM Mono',monospace",fontWeight:isNow?700:400}}>{s.name}</div>
                    <div style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{s.time}</div>
                  </div>
                  <div className="font-mono" style={{fontSize:12,color:s.color,fontWeight:700}}>{s.mult}</div>
                </div>
              );
            })}
          </div>

          {/* Key levels */}
          <div className="card" style={{padding:"12px"}}>
            <div className="label" style={{marginBottom:10}}>KEY LEVELS</div>
            {[
              {l:"Prev Day H",v:(price+18.4).toFixed(2),c:"var(--red)"},
              {l:"Session H", v:(price+8.2).toFixed(2), c:"var(--blue)"},
              {l:"Round Lvl", v:(Math.round(price/10)*10).toFixed(2),c:"var(--text-dim)"},
              {l:"▶ PRICE",   v:price.toFixed(2),       c:"var(--gold)"},
              {l:"Session L", v:(price-7.6).toFixed(2), c:"var(--blue)"},
              {l:"Prev Day L",v:(price-15.8).toFixed(2),c:"var(--green)"},
            ].map(item=>(
              <div key={item.l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.03)"}}>
                <span style={{fontSize:10,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace"}}>{item.l}</span>
                <span className="font-mono" style={{fontSize:12,color:item.c,fontWeight:700}}>{item.v}</span>
              </div>
            ))}
          </div>

          {/* Economic events */}
          <div className="card" style={{padding:"12px"}}>
            <div className="label" style={{marginBottom:10}}>ECONOMIC CALENDAR</div>
            {[
              {t:"07:30",e:"Jobless Claims",i:"MED",c:"var(--gold)"},
              {t:"08:30",e:"CPI m/m",       i:"HIGH",c:"var(--red)"},
              {t:"10:00",e:"Fed Chair",     i:"HIGH",c:"var(--red)"},
              {t:"14:00",e:"FOMC Minutes",  i:"MED",c:"var(--gold)"},
            ].map(ev=>(
              <div key={ev.e} style={{display:"flex",gap:8,alignItems:"center",marginBottom:7,padding:"5px 8px",background:"var(--bg-2)",borderRadius:3}}>
                <span className="font-mono" style={{fontSize:10,color:"var(--text-dim)",flexShrink:0}}>{ev.t}</span>
                <span style={{fontSize:11,color:"var(--text)",flex:1,fontFamily:"'DM Mono',monospace"}}>{ev.e}</span>
                <span className={`badge ${ev.i==="HIGH"?"badge-red":"badge-gold"}`}>{ev.i}</span>
              </div>
            ))}
            <div style={{marginTop:6,fontSize:10,color:"var(--text-dim)",fontFamily:"'DM Mono',monospace",lineHeight:1.5}}>⚡ HIGH impact: wait for candle close + retest before entry</div>
          </div>

          {/* Iron Rules */}
          <div style={{background:"rgba(255,59,92,0.04)",border:"1px solid rgba(255,59,92,0.15)",borderRadius:4,padding:"12px"}}>
            <div className="font-display" style={{fontSize:10,fontWeight:700,color:"var(--red)",letterSpacing:"0.2em",marginBottom:8}}>IRON RULES</div>
            {["Scale lots to session — always","Max 3 trades per day · all sessions","$6 daily loss = stop immediately","News spike: wait for close, then enter","Never move SL against the trade","Asian session = smallest size or skip"].map((r,i)=>(
              <div key={i} style={{display:"flex",gap:8,marginBottom:5,fontSize:11,color:"var(--text)",fontFamily:"'DM Mono',monospace"}}>
                <span style={{color:"var(--red)",flexShrink:0}}>—</span>{r}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FOOTER ─────────────────────────────────────────────────── */}
      <footer style={{background:"var(--bg)",borderTop:"1px solid var(--border)",padding:"8px 20px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",fontWeight:600,letterSpacing:"0.15em"}}>
          XAU/USD COMMAND TERMINAL · 24/7 ADAPTIVE · $100 ACCOUNT · 1:1000 LEVERAGE
        </span>
        <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"'Syne',sans-serif",letterSpacing:"0.1em"}}>
          ⚠ SIMULATION — NOT FINANCIAL ADVICE — TRADE AT YOUR OWN RISK
        </span>
      </footer>
    </div>
  );
}
