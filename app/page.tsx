"use client";
import { useState, useEffect, useCallback, useRef } from "react";

interface Candle { time: number; open: number; high: number; low: number; close: number; }
interface Trade { id: number; type: "LONG" | "SHORT"; entry: number; sl: number; tp1: number; tp2: number; lot: number; risk: number; status: "OPEN" | "TP1" | "TP2" | "SL" | "BE"; pnl: number; time: string; session: string; }
interface Signal { confluence: number; direction: "LONG" | "SHORT" | "WAIT"; ema: boolean; rsi: boolean; structure: boolean; rsiVal: number; emaStack: string; reason: string; }
interface ChecklistItem { id: string; label: string; done: boolean; }

const fmt = (n: number, d = 2) => n.toFixed(d);
const fmtUSD = (n: number) => (n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(2);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Session detection based on CT time
function getSession(ctHour: number, ctMin: number): { name: string; color: string; description: string; strategy: string } {
  const t = ctHour + ctMin / 60;
  if (t >= 7 && t < 10)   return { name: "LONDON/NY OVERLAP", color: "#00E676", description: "HIGHEST VOLATILITY — Best setups", strategy: "All 3 confluences. Aggressive R:R 1:2+" };
  if (t >= 2 && t < 7)    return { name: "LONDON OPEN", color: "#FFB800", description: "High liquidity, strong moves", strategy: "Wait for London breakout. 2+ confluence OK" };
  if (t >= 10 && t < 12)  return { name: "NY MORNING", color: "#FFB800", description: "Good momentum, watch for reversal", strategy: "Trend continuation only. Tight SL" };
  if (t >= 12 && t < 14)  return { name: "NY MIDDAY", color: "#FF8C00", description: "Choppy — reduced position size", strategy: "Reduce lot 50%. Scalps only. 1:1 R:R" };
  if (t >= 14 && t < 19)  return { name: "NY AFTERNOON", color: "#00B0FF", description: "Moderate moves, watch close", strategy: "Trend trades only. No counter-trend" };
  if (t >= 19 && t < 24)  return { name: "ASIAN OPEN", color: "#9C27B0", description: "Low volatility, range-bound", strategy: "Reduce lot 70%. Range highs/lows only" };
  return { name: "ASIAN SESSION", color: "#9C27B0", description: "Range-bound — minimal moves", strategy: "Smallest lot only. Mark ranges for London" };
}

function getRiskMultiplier(sessionName: string): number {
  if (sessionName.includes("OVERLAP")) return 1.0;
  if (sessionName.includes("LONDON OPEN")) return 0.8;
  if (sessionName.includes("NY MORNING")) return 0.8;
  if (sessionName.includes("NY MIDDAY")) return 0.4;
  if (sessionName.includes("NY AFTERNOON")) return 0.6;
  return 0.3; // Asian
}

function goldPrice(base: number, t: number): number {
  return base + Math.sin(t * 0.7) * 4 + Math.sin(t * 1.3) * 2 + Math.sin(t * 0.2) * 8 + Math.random() * 1.5 - 0.75;
}

function calcLot(risk: number, sl: number): number {
  const lot = risk / (sl * 0.01 * 100);
  return Math.max(0.01, Math.floor(lot * 100) / 100);
}

function calcSignal(price: number, t: number): Signal {
  const emaShort = price + Math.sin(t * 0.4) * 2;
  const emaMid = price + Math.sin(t * 0.2) * 3;
  const emaLong = price - Math.sin(t * 0.1) * 5;
  const rsiVal = clamp(50 + Math.sin(t * 0.6) * 22 + Math.sin(t * 1.2) * 8, 25, 78);
  const emaOk = emaShort > emaMid && emaMid > emaLong;
  const emaOkShort = emaShort < emaMid && emaMid < emaLong;
  const rsiOkLong = rsiVal > 50 && rsiVal < 70;
  const rsiOkShort = rsiVal < 50 && rsiVal > 30;
  const structureSwept = Math.sin(t * 0.3) > 0.3;
  if (emaOk && rsiOkLong && structureSwept) return { confluence: 3, direction: "LONG", ema: true, rsi: true, structure: true, rsiVal, emaStack: "Bullish", reason: "Liquidity sweep + EMA aligned + RSI momentum" };
  if (emaOkShort && rsiOkShort && structureSwept) return { confluence: 2, direction: "SHORT", ema: true, rsi: true, structure: false, rsiVal, emaStack: "Bearish", reason: "EMA bearish stack + RSI below 50" };
  const c = (emaOk || emaOkShort ? 1 : 0) + (rsiOkLong || rsiOkShort ? 1 : 0) + (structureSwept ? 1 : 0);
  return { confluence: c, direction: "WAIT", ema: emaOk || emaOkShort, rsi: rsiOkLong || rsiOkShort, structure: structureSwept, rsiVal, emaStack: "Neutral", reason: "Insufficient confluence — wait for setup" };
}

const CHECKLIST: ChecklistItem[] = [
  { id: "c1", label: "Identify current session & adjust lot size", done: false },
  { id: "c2", label: "Mark previous session high & low", done: false },
  { id: "c3", label: "Check economic calendar for next 2 hours", done: false },
  { id: "c4", label: "Identify nearest $10 round number level", done: false },
  { id: "c5", label: "Determine bias from higher timeframe (1H)", done: false },
  { id: "c6", label: "Confirm spread < 30 pips before entry", done: false },
  { id: "c7", label: "Apply session risk multiplier to lot size", done: false },
  { id: "c8", label: "Confirm 3 confluences (2 in low sessions)", done: false },
  { id: "c9", label: "Set TP1 at 1:1, TP2 at 2:1 before entry", done: false },
  { id: "c10", label: "Max daily loss $6 — stop if hit", done: false },
];

function CandleChart({ candles, price }: { candles: Candle[]; price: number }) {
  const W = 600, H = 200;
  if (candles.length < 2) return null;
  const prices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const toY = (p: number) => H - ((p - minP) / range) * (H - 20) - 10;
  const cw = Math.max(2, Math.floor((W - 40) / candles.length) - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ background: "transparent" }}>
      {[0, 0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={0} y1={toY(minP + f * range)} x2={W} y2={toY(minP + f * range)} stroke="#141C24" strokeWidth={1} />)}
      {candles.map((c, i) => {
        const x = 20 + i * (cw + 1), bull = c.close >= c.open, color = bull ? "#00E676" : "#FF1744";
        const bodyTop = toY(Math.max(c.open, c.close)), bodyH = Math.max(2, Math.abs(toY(c.open) - toY(c.close)));
        return <g key={i}><line x1={x + cw / 2} y1={toY(c.high)} x2={x + cw / 2} y2={toY(c.low)} stroke={color} strokeWidth={1} opacity={0.7} /><rect x={x} y={bodyTop} width={cw} height={bodyH} fill={color} opacity={0.85} /></g>;
      })}
      <line x1={0} y1={toY(price)} x2={W} y2={toY(price)} stroke="#FFB800" strokeWidth={1} strokeDasharray="4,3" opacity={0.9} />
      <rect x={W - 70} y={toY(price) - 9} width={68} height={16} fill="#1A1200" stroke="#FFB800" strokeWidth={1} rx={2} />
      <text x={W - 36} y={toY(price) + 4} fill="#FFB800" fontSize={9} textAnchor="middle" fontFamily="'Share Tech Mono',monospace">{fmt(price)}</text>
    </svg>
  );
}

function RsiChart({ history }: { history: number[] }) {
  const W = 200, H = 60;
  if (history.length < 2) return null;
  const pts = history.map((v, i) => `${(i / (history.length - 1)) * W},${H - (v / 100) * H}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }}>
      <line x1={0} y1={H * 0.3} x2={W} y2={H * 0.3} stroke="#FF1744" strokeWidth={0.5} opacity={0.4} />
      <line x1={0} y1={H * 0.5} x2={W} y2={H * 0.5} stroke="#FFB800" strokeWidth={0.5} opacity={0.3} />
      <line x1={0} y1={H * 0.7} x2={W} y2={H * 0.7} stroke="#00E676" strokeWidth={0.5} opacity={0.4} />
      <polyline points={pts} fill="none" stroke="#00B0FF" strokeWidth={1.5} opacity={0.9} />
    </svg>
  );
}

export default function GoldDashboard() {
  const BASE = 3340.50;
  const [price, setPrice] = useState(BASE);
  const [prevPrice, setPrevPrice] = useState(BASE);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signal, setSignal] = useState<Signal>({ confluence: 0, direction: "WAIT", ema: false, rsi: false, structure: false, rsiVal: 50, emaStack: "Neutral", reason: "Initializing..." });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(CHECKLIST);
  const [account, setAccount] = useState({ equity: 100, dailyPnl: 0, tradesCount: 0 });
  const [rsiHistory, setRsiHistory] = useState<number[]>([50]);
  const [ctTime, setCtTime] = useState("");
  const [ctHour, setCtHour] = useState(0);
  const [ctMin, setCtMin] = useState(0);
  const [session, setSession] = useState(getSession(8, 0));
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [tab, setTab] = useState<"chart" | "trades" | "checklist" | "rules">("chart");
  const tickRef = useRef(0);
  const candleRef = useRef<Candle>({ time: Date.now(), open: BASE, high: BASE, low: BASE, close: BASE });

  // Clock
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const ct = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
      setCtTime(ct);
      const parts = ct.split(":");
      const h = parseInt(parts[0]), m = parseInt(parts[1]);
      setCtHour(h); setCtMin(m);
      setSession(getSession(h, m));
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  // Price feed
  useEffect(() => {
    const iv = setInterval(() => {
      tickRef.current += 0.05;
      const t = tickRef.current;
      const np = goldPrice(BASE, t);
      const sig = calcSignal(np, t);
      setPrice(prev => { setPrevPrice(prev); return np; });
      setSignal(sig);
      setRsiHistory(h => [...h.slice(-49), sig.rsiVal]);
      const now = Date.now();
      candleRef.current.high = Math.max(candleRef.current.high, np);
      candleRef.current.low = Math.min(candleRef.current.low, np);
      candleRef.current.close = np;
      if (now - candleRef.current.time >= 5000) {
        setCandles(prev => [...prev, { ...candleRef.current }].slice(-80));
        candleRef.current = { time: now, open: np, high: np, low: np, close: np };
      }
      setTrades(prev => prev.map(tr => {
        if (tr.status !== "OPEN") return tr;
        const pips = tr.type === "LONG" ? (np - tr.entry) * 10 : (tr.entry - np) * 10;
        const pnl = pips * tr.lot * 0.01 * 100;
        if (tr.type === "LONG" && np >= tr.tp2) return { ...tr, status: "TP2", pnl: tr.risk * 2 };
        if (tr.type === "LONG" && np >= tr.tp1) return { ...tr, status: "TP1", pnl: tr.risk };
        if (tr.type === "LONG" && np <= tr.sl) return { ...tr, status: "SL", pnl: -tr.risk };
        if (tr.type === "SHORT" && np <= tr.tp2) return { ...tr, status: "TP2", pnl: tr.risk * 2 };
        if (tr.type === "SHORT" && np <= tr.tp1) return { ...tr, status: "TP1", pnl: tr.risk };
        if (tr.type === "SHORT" && np >= tr.sl) return { ...tr, status: "SL", pnl: -tr.risk };
        return { ...tr, pnl };
      }));
    }, 300);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const closed = trades.filter(t => t.status !== "OPEN").reduce((s, t) => s + t.pnl, 0);
    const open = trades.filter(t => t.status === "OPEN").reduce((s, t) => s + t.pnl, 0);
    setAccount(a => ({ ...a, equity: 100 + closed + open, dailyPnl: closed + open, tradesCount: trades.length }));
  }, [trades]);

  const placeTrade = useCallback((type: "LONG" | "SHORT") => {
    if (account.tradesCount >= 3 || account.dailyPnl <= -6) return;
    const slPips = 20;
    const riskMultiplier = getRiskMultiplier(session.name);
    const baseRisk = 2;
    const risk = parseFloat((baseRisk * riskMultiplier).toFixed(2));
    const lot = calcLot(risk, slPips);
    const sl = type === "LONG" ? price - slPips * 0.1 : price + slPips * 0.1;
    const tp1 = type === "LONG" ? price + slPips * 0.1 : price - slPips * 0.1;
    const tp2 = type === "LONG" ? price + slPips * 0.2 : price - slPips * 0.2;
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    setTrades(prev => [...prev, { id: Date.now(), type, entry: price, sl, tp1, tp2, lot, risk, status: "OPEN", pnl: 0, time, session: session.name }]);
  }, [price, account, session]);

  const getAiAnalysis = async () => {
    setAiLoading(true); setAiAnalysis("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: "You are a 25-year veteran XAU/USD gold trader operating 24/7. Be concise and direct. Format: MARKET BIAS (2 sentences), SESSION EDGE (2 sentences), ACTION PLAN (3 bullets). Under 150 words.",
          messages: [{ role: "user", content: `XAU/USD: $${fmt(price)} | Session: ${session.name} | CT: ${ctTime} | Signal: ${signal.direction} | Confluence: ${signal.confluence}/3 | RSI: ${fmt(signal.rsiVal,1)} | EMA: ${signal.emaStack} | Daily P&L: ${fmtUSD(account.dailyPnl)} | Equity: $${fmt(account.equity)} | Risk Multiplier: ${getRiskMultiplier(session.name)}x\nGive professional analysis for this session.` }]
        })
      });
      const data = await res.json();
      setAiAnalysis(data.content?.find((b: {type:string}) => b.type === "text")?.text || "Unavailable.");
    } catch { setAiAnalysis("⚠ Connect Anthropic API key to enable AI analysis."); }
    setAiLoading(false);
  };

  const riskMultiplier = getRiskMultiplier(session.name);
  const currentRisk = parseFloat((2 * riskMultiplier).toFixed(2));
  const currentLot = calcLot(currentRisk, 20);
  const riskLimitHit = account.dailyPnl <= -6;
  const maxTradesHit = account.tradesCount >= 3;
  const priceUp = price >= prevPrice;
  const checklistDone = checklist.filter(c => c.done).length;

  const SESSION_SCHEDULE = [
    { time: "00:00–02:00 CT", name: "Asian Session", color: "#9C27B0", risk: "30%", tip: "Mark ranges only" },
    { time: "02:00–07:00 CT", name: "London Open", color: "#FFB800", risk: "80%", tip: "Breakout trades" },
    { time: "07:00–10:00 CT", name: "London/NY Overlap", color: "#00E676", risk: "100%", tip: "BEST setups" },
    { time: "10:00–12:00 CT", name: "NY Morning", color: "#FFB800", risk: "80%", tip: "Trend continuation" },
    { time: "12:00–14:00 CT", name: "NY Midday", color: "#FF8C00", risk: "40%", tip: "Scalps only" },
    { time: "14:00–19:00 CT", name: "NY Afternoon", color: "#00B0FF", risk: "60%", tip: "Trend trades only" },
    { time: "19:00–00:00 CT", name: "Asian Open", color: "#9C27B0", risk: "30%", tip: "Range highs/lows" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#040608", color: "#E8F0F8" }}>

      {/* TOP BAR */}
      <div style={{ background: "#080C10", borderBottom: "1px solid #141C24", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span className="orbitron" style={{ fontSize: 14, color: "#FFB800", letterSpacing: "0.15em", fontWeight: 700 }}>XAUUSD COMMAND</span>
          <span style={{ fontSize: 11, color: "#6B8099", fontFamily: "monospace" }}>24/7 · ADAPTIVE STRATEGY</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: session.color }} className="pulse-live" />
            <span style={{ fontSize: 11, color: session.color, fontFamily: "monospace", fontWeight: 700 }}>{session.name}</span>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 18, color: "#FFB800", letterSpacing: "0.1em", fontWeight: 700 }}>{ctTime || "00:00:00"}</div>
            <div style={{ fontSize: 9, color: "#6B8099", letterSpacing: "0.1em" }}>CHICAGO TIME</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 16, color: account.equity >= 100 ? "#00E676" : "#FF1744" }}>${fmt(account.equity)}</div>
            <div style={{ fontSize: 9, color: "#6B8099" }}>EQUITY</div>
          </div>
        </div>
      </div>

      {/* SESSION BANNER */}
      <div style={{ background: `linear-gradient(90deg, ${session.color}18, transparent)`, borderBottom: `1px solid ${session.color}30`, padding: "6px 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <span style={{ fontSize: 11, color: session.color, fontWeight: 700 }}>{session.description}</span>
          <span style={{ fontSize: 11, color: "#6B8099" }}>Strategy: <span style={{ color: "#E8F0F8" }}>{session.strategy}</span></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: 11, color: "#6B8099" }}>Risk Mult: <span className="mono" style={{ color: session.color, fontWeight: 700 }}>{riskMultiplier}x</span></span>
          <span style={{ fontSize: 11, color: "#6B8099" }}>Active Lot: <span className="mono" style={{ color: "#FFB800", fontWeight: 700 }}>{currentLot.toFixed(2)}</span></span>
          <span style={{ fontSize: 11, color: "#6B8099" }}>Risk/Trade: <span className="mono" style={{ color: "#00E676", fontWeight: 700 }}>${currentRisk}</span></span>
          {riskLimitHit && <span style={{ padding: "2px 10px", border: "1px solid #FF1744", borderRadius: 2, fontSize: 11, color: "#FF1744" }}>⛔ DAILY LIMIT HIT</span>}
          {!riskLimitHit && maxTradesHit && <span style={{ padding: "2px 10px", border: "1px solid #FFB800", borderRadius: 2, fontSize: 11, color: "#FFB800" }}>⚠ MAX 3 TRADES</span>}
        </div>
      </div>

      {/* PRICE ROW */}
      <div style={{ background: "#0A0E14", borderBottom: "1px solid #141C24", padding: "6px 1.5rem", display: "flex", alignItems: "center", gap: "2rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#6B8099" }}>XAU/USD</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: priceUp ? "#00E676" : "#FF1744", transition: "color 0.3s" }}>{fmt(price)}</span>
          <span style={{ fontSize: 13, color: priceUp ? "#00E676" : "#FF1744" }}>{priceUp ? "▲" : "▼"} {fmt(Math.abs(price - BASE))}</span>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", fontSize: 11, color: "#6B8099" }}>
          <span>BID <span className="mono" style={{ color: "#E8F0F8" }}>{fmt(price - 0.15)}</span></span>
          <span>ASK <span className="mono" style={{ color: "#E8F0F8" }}>{fmt(price + 0.15)}</span></span>
          <span>SPREAD <span className="mono" style={{ color: "#FFB800" }}>0.30</span></span>
          <span>ATR <span className="mono" style={{ color: "#00B0FF" }}>12.4</span></span>
        </div>
      </div>

      {/* MAIN GRID */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 260px", gap: "1px", background: "#141C24", minHeight: "calc(100vh - 140px)" }}>

        {/* LEFT */}
        <div style={{ background: "#080C10", padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Signal */}
          <div style={{ background: "#0C1117", border: `1px solid ${signal.direction === "LONG" ? "rgba(0,230,118,0.4)" : signal.direction === "SHORT" ? "rgba(255,23,68,0.4)" : "rgba(255,184,0,0.2)"}`, borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 6 }}>SIGNAL ANALYSIS</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="orbitron" style={{ fontSize: 20, fontWeight: 700, color: signal.direction === "LONG" ? "#00E676" : signal.direction === "SHORT" ? "#FF1744" : "#FFB800" }}>{signal.direction}</div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#6B8099" }}>CONFLUENCE</div>
                <div className="mono" style={{ fontSize: 20, color: signal.confluence >= 3 ? "#00E676" : signal.confluence >= 2 ? "#FFB800" : "#6B8099" }}>{signal.confluence}/3</div>
              </div>
            </div>
            {[{ label: "EMA Stack", ok: signal.ema, detail: signal.emaStack }, { label: "RSI", ok: signal.rsi, detail: fmt(signal.rsiVal, 1) }, { label: "Structure", ok: signal.structure, detail: signal.structure ? "Swept" : "Pending" }].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <span style={{ color: item.ok ? "#00E676" : "#FF1744" }}>{item.ok ? "✓" : "✗"}</span>
                  <span style={{ color: "#6B8099" }}>{item.label}</span>
                </div>
                <span className="mono" style={{ fontSize: 11, color: item.ok ? "#E8F0F8" : "#6B8099" }}>{item.detail}</span>
              </div>
            ))}
            <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(255,184,0,0.05)", borderRadius: 2, fontSize: 11, color: "#FFB800", lineHeight: 1.4 }}>{signal.reason}</div>
          </div>

          {/* RSI */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em" }}>RSI (14)</span>
              <span className="mono" style={{ fontSize: 14, color: signal.rsiVal > 70 ? "#FF1744" : signal.rsiVal < 30 ? "#00E676" : "#00B0FF" }}>{fmt(signal.rsiVal, 1)}</span>
            </div>
            <RsiChart history={rsiHistory} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#6B8099", marginTop: 2 }}>
              <span style={{ color: "#00E676" }}>30 OS</span><span style={{ color: "#FFB800" }}>50 MID</span><span style={{ color: "#FF1744" }}>70 OB</span>
            </div>
          </div>

          {/* Lot Calc — session adjusted */}
          <div style={{ background: "#0C1117", border: `1px solid ${session.color}30`, borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 4 }}>LOT SIZE — {session.name.split("/")[0]}</div>
            <div style={{ fontSize: 10, color: session.color, marginBottom: 8 }}>Risk multiplier: {riskMultiplier}x active</div>
            {[15, 20, 25, 30].map(sl => {
              const r = parseFloat((2 * riskMultiplier).toFixed(2));
              const l = calcLot(r, sl);
              return (
                <div key={sl} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                  <span style={{ color: "#6B8099" }}>SL {sl}p</span>
                  <span className="mono" style={{ color: "#FFB800" }}>{l.toFixed(2)} lot</span>
                  <span className="mono" style={{ color: "#00E676" }}>${r} risk</span>
                </div>
              );
            })}
          </div>

          {/* Account */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>ACCOUNT</div>
            {[
              { label: "Capital", val: "$100.00", color: "#6B8099" },
              { label: "Leverage", val: "1:1000", color: "#00B0FF" },
              { label: "Equity", val: `$${fmt(account.equity)}`, color: account.equity >= 100 ? "#00E676" : "#FF1744" },
              { label: "Daily P&L", val: fmtUSD(account.dailyPnl), color: account.dailyPnl >= 0 ? "#00E676" : "#FF1744" },
              { label: "Trades Today", val: `${account.tradesCount}/3`, color: maxTradesHit ? "#FF1744" : "#FFB800" },
              { label: "Daily Loss Limit", val: "$6.00 (6%)", color: "#6B8099" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 12 }}>
                <span style={{ color: "#6B8099" }}>{item.label}</span>
                <span className="mono" style={{ color: item.color }}>{item.val}</span>
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: "#6B8099", marginBottom: 3 }}>DAILY LOSS BUFFER</div>
              <div style={{ height: 4, background: "#141C24", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${clamp(((6 + account.dailyPnl) / 6) * 100, 0, 100)}%`, background: account.dailyPnl > -3 ? "#00E676" : "#FF1744", transition: "width 0.5s" }} />
              </div>
              <div className="mono" style={{ fontSize: 9, color: "#6B8099", marginTop: 2 }}>${fmt(Math.max(0, 6 + account.dailyPnl))} remaining</div>
            </div>
          </div>
        </div>

        {/* CENTER */}
        <div style={{ background: "#080C10", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", borderBottom: "1px solid #141C24" }}>
            {(["chart", "trades", "checklist", "rules"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 20px", fontSize: 11, letterSpacing: "0.1em", fontFamily: "inherit", border: "none", cursor: "pointer", borderBottom: tab === t ? "2px solid #FFB800" : "2px solid transparent", background: tab === t ? "rgba(255,184,0,0.05)" : "transparent", color: tab === t ? "#FFB800" : "#6B8099", textTransform: "uppercase", fontWeight: 600 }}>
                {t}
              </button>
            ))}
          </div>

          {tab === "chart" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "1rem", gap: "0.75rem" }}>
              <div style={{ flex: 1, background: "#040608", border: "1px solid #141C24", borderRadius: 2, overflow: "hidden", minHeight: 200 }}>
                <CandleChart candles={candles} price={price} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button onClick={() => placeTrade("LONG")} disabled={maxTradesHit || riskLimitHit} style={{ padding: "14px", background: maxTradesHit || riskLimitHit ? "#0C1117" : "rgba(0,230,118,0.1)", border: `1px solid ${maxTradesHit || riskLimitHit ? "#141C24" : "rgba(0,230,118,0.5)"}`, borderRadius: 2, color: maxTradesHit || riskLimitHit ? "#6B8099" : "#00E676", fontSize: 14, fontWeight: 700, cursor: maxTradesHit || riskLimitHit ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                  ▲ LONG · {currentLot.toFixed(2)} lot · ${currentRisk}
                </button>
                <button onClick={() => placeTrade("SHORT")} disabled={maxTradesHit || riskLimitHit} style={{ padding: "14px", background: maxTradesHit || riskLimitHit ? "#0C1117" : "rgba(255,23,68,0.1)", border: `1px solid ${maxTradesHit || riskLimitHit ? "#141C24" : "rgba(255,23,68,0.5)"}`, borderRadius: 2, color: maxTradesHit || riskLimitHit ? "#6B8099" : "#FF1744", fontSize: 14, fontWeight: 700, cursor: maxTradesHit || riskLimitHit ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                  ▼ SHORT · {currentLot.toFixed(2)} lot · ${currentRisk}
                </button>
              </div>
              <div style={{ fontSize: 10, color: "#6B8099", textAlign: "center" }}>
                SL: 20 pips · TP1: 1:1 · TP2: 2:1 · Session: {session.name} · Multiplier: {riskMultiplier}x · Max 3 trades/day
              </div>
              <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em" }}>AI MARKET ANALYSIS</span>
                  <button onClick={getAiAnalysis} disabled={aiLoading} style={{ padding: "4px 12px", background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.3)", borderRadius: 2, color: "#FFB800", fontSize: 11, cursor: aiLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                    {aiLoading ? "ANALYZING..." : "GET ANALYSIS"}
                  </button>
                </div>
                {aiLoading && <div style={{ fontSize: 11, color: "#6B8099" }}>Consulting strategy engine<span className="blink">▋</span></div>}
                {aiAnalysis && <div style={{ fontSize: 12, color: "#E8F0F8", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{aiAnalysis}</div>}
                {!aiAnalysis && !aiLoading && <div style={{ fontSize: 11, color: "#6B8099" }}>Click &quot;Get Analysis&quot; for session-aware AI market read.</div>}
              </div>
            </div>
          )}

          {tab === "trades" && (
            <div style={{ flex: 1, padding: "1rem", overflowY: "auto" }}>
              <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 12 }}>TRADE LOG — ALL SESSIONS</div>
              {trades.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#6B8099", fontSize: 13 }}>No trades yet.<br /><span style={{ fontSize: 11 }}>Wait for confluence setup in any session.</span></div>}
              {trades.map(tr => (
                <div key={tr.id} className="slide-in" style={{ background: "#0C1117", border: `1px solid ${tr.status === "TP2" ? "rgba(0,230,118,0.4)" : tr.status === "SL" ? "rgba(255,23,68,0.3)" : "rgba(255,184,0,0.2)"}`, borderRadius: 2, padding: "0.75rem", marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 2, fontSize: 11, fontWeight: 700, background: tr.type === "LONG" ? "rgba(0,230,118,0.15)" : "rgba(255,23,68,0.15)", color: tr.type === "LONG" ? "#00E676" : "#FF1744" }}>{tr.type}</span>
                      <span className="mono" style={{ fontSize: 10, color: "#6B8099" }}>{tr.time}</span>
                      <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(255,184,0,0.1)", color: "#FFB800" }}>{tr.session?.split("/")[0] || "—"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span className="mono" style={{ fontSize: 13, color: tr.pnl >= 0 ? "#00E676" : "#FF1744", fontWeight: 700 }}>{fmtUSD(tr.pnl)}</span>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 2, background: tr.status === "OPEN" ? "rgba(255,184,0,0.1)" : tr.status === "SL" ? "rgba(255,23,68,0.1)" : "rgba(0,230,118,0.1)", color: tr.status === "OPEN" ? "#FFB800" : tr.status === "SL" ? "#FF1744" : "#00E676" }}>{tr.status}</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 4, fontSize: 10 }}>
                    {[{ l: "Entry", v: fmt(tr.entry) }, { l: "SL", v: fmt(tr.sl) }, { l: "TP1", v: fmt(tr.tp1) }, { l: "TP2", v: fmt(tr.tp2) }, { l: "Lot", v: tr.lot.toFixed(2) }].map(item => (
                      <div key={item.l}><div style={{ color: "#6B8099" }}>{item.l}</div><div className="mono" style={{ color: "#E8F0F8" }}>{item.v}</div></div>
                    ))}
                  </div>
                </div>
              ))}
              {trades.length > 0 && (
                <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem", marginTop: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, fontSize: 12 }}>
                    <div><div style={{ color: "#6B8099", fontSize: 10 }}>WIN RATE</div><div className="mono" style={{ color: "#00E676" }}>{trades.length > 0 ? Math.round((trades.filter(t => ["TP1","TP2"].includes(t.status)).length / Math.max(1, trades.filter(t => t.status !== "OPEN").length)) * 100) : 0}%</div></div>
                    <div><div style={{ color: "#6B8099", fontSize: 10 }}>CLOSED P&L</div><div className="mono" style={{ color: trades.filter(t => t.status !== "OPEN").reduce((s,t) => s+t.pnl,0) >= 0 ? "#00E676" : "#FF1744" }}>{fmtUSD(trades.filter(t => t.status !== "OPEN").reduce((s,t) => s+t.pnl,0))}</div></div>
                    <div><div style={{ color: "#6B8099", fontSize: 10 }}>TOTAL</div><div className="mono" style={{ color: "#FFB800" }}>{trades.length}</div></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "checklist" && (
            <div style={{ flex: 1, padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em" }}>PRE-TRADE CHECKLIST</span>
                <span className="mono" style={{ fontSize: 13, color: checklistDone === checklist.length ? "#00E676" : "#FFB800" }}>{checklistDone}/{checklist.length}</span>
              </div>
              <div style={{ height: 4, background: "#141C24", borderRadius: 2, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ height: "100%", width: `${(checklistDone / checklist.length) * 100}%`, background: checklistDone === checklist.length ? "#00E676" : "#FFB800", transition: "width 0.3s" }} />
              </div>
              {checklist.map(item => (
                <div key={item.id} onClick={() => setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, done: !c.done } : c))} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 8px", marginBottom: 4, cursor: "pointer", background: item.done ? "rgba(0,230,118,0.05)" : "transparent", border: `1px solid ${item.done ? "rgba(0,230,118,0.2)" : "#141C24"}`, borderRadius: 2, transition: "all 0.2s" }}>
                  <div style={{ width: 18, height: 18, border: `1px solid ${item.done ? "#00E676" : "#6B8099"}`, borderRadius: 2, background: item.done ? "#00E676" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                    {item.done && <span style={{ color: "#040608", fontSize: 12, fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 13, color: item.done ? "#6B8099" : "#E8F0F8", textDecoration: item.done ? "line-through" : "none", lineHeight: 1.4 }}>{item.label}</span>
                </div>
              ))}
              <button onClick={() => setChecklist(CHECKLIST)} style={{ marginTop: 12, width: "100%", padding: "8px", background: "transparent", border: "1px solid #141C24", borderRadius: 2, color: "#6B8099", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>RESET CHECKLIST</button>
            </div>
          )}

          {tab === "rules" && (
            <div style={{ flex: 1, padding: "1rem", overflowY: "auto" }}>
              <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 12 }}>24/7 ADAPTIVE STRATEGY — SESSION SCHEDULE</div>
              {SESSION_SCHEDULE.map(s => (
                <div key={s.name} style={{ background: "#0C1117", border: `1px solid ${s.color}30`, borderRadius: 2, padding: "0.75rem", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, color: s.color, fontWeight: 700, marginBottom: 2 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#6B8099" }}>{s.time}</div>
                    <div style={{ fontSize: 11, color: "#E8F0F8", marginTop: 2 }}>{s.tip}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#6B8099" }}>RISK</div>
                    <div className="mono" style={{ fontSize: 16, color: s.color, fontWeight: 700 }}>{s.risk}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 8 }}>
                {[
                  { title: "UNIVERSAL ENTRY RULES", color: "#FFB800", rules: ["London/NY Overlap: All 3 confluences required", "London Open & NY sessions: 2+ confluences OK", "Asian sessions: Only high-quality 3-confluence setups", "Never trade 30 min before/after major news"] },
                  { title: "RISK MANAGEMENT 24/7", color: "#FF1744", rules: ["Max 3 trades per day across all sessions", "Daily loss limit: $6.00 — stop immediately if hit", "Lot size auto-adjusts per session multiplier", "Never risk more than session-adjusted amount", "Balance < $80: drop to 50% of all lot sizes"] },
                  { title: "MOST PROFITABLE SESSIONS", color: "#00E676", rules: ["#1 London/NY Overlap (07:00–10:00 CT) — 100% risk", "#2 London Open (02:00–07:00 CT) — 80% risk", "#3 NY Morning (10:00–12:00 CT) — 80% risk", "Asian session: range-mark only, minimal trading"] },
                ].map(section => (
                  <div key={section.title} style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem", marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: section.color, letterSpacing: "0.15em", marginBottom: 6, fontWeight: 700 }}>{section.title}</div>
                    {section.rules.map((rule, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, fontSize: 12, color: "#E8F0F8", lineHeight: 1.4 }}>
                        <span style={{ color: section.color, flexShrink: 0 }}>›</span><span>{rule}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div style={{ background: "#080C10", padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Current Session Detail */}
          <div style={{ background: "#0C1117", border: `1px solid ${session.color}40`, borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 6 }}>ACTIVE SESSION</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: session.color, marginBottom: 4 }}>{session.name}</div>
            <div style={{ fontSize: 11, color: "#E8F0F8", marginBottom: 4 }}>{session.description}</div>
            <div style={{ fontSize: 11, color: "#6B8099", marginBottom: 8 }}>{session.strategy}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <div style={{ padding: "6px", background: "#040608", borderRadius: 2, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#6B8099" }}>LOT SIZE</div>
                <div className="mono" style={{ fontSize: 16, color: "#FFB800", fontWeight: 700 }}>{currentLot.toFixed(2)}</div>
              </div>
              <div style={{ padding: "6px", background: "#040608", borderRadius: 2, textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#6B8099" }}>RISK/TRADE</div>
                <div className="mono" style={{ fontSize: 16, color: "#00E676", fontWeight: 700 }}>${currentRisk}</div>
              </div>
            </div>
          </div>

          {/* Session Timeline */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>SESSION TIMELINE (CT)</div>
            {SESSION_SCHEDULE.map(s => {
              const isActive = s.name === session.name || session.name.includes(s.name.split("/")[0]);
              return (
                <div key={s.name} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, padding: "3px 6px", background: isActive ? `${s.color}15` : "transparent", borderRadius: 2, border: isActive ? `1px solid ${s.color}30` : "1px solid transparent" }}>
                  <div>
                    <div style={{ fontSize: 10, color: isActive ? s.color : "#6B8099", fontWeight: isActive ? 700 : 400 }}>{s.name}</div>
                    <div style={{ fontSize: 9, color: "#6B8099" }}>{s.time}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: s.color, alignSelf: "center" }}>{s.risk}</div>
                </div>
              );
            })}
          </div>

          {/* Key Levels */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>KEY PRICE LEVELS</div>
            {[
              { label: "Prev Day High", val: fmt(price + 18.40), color: "#FF1744" },
              { label: "Session High", val: fmt(price + 8.20), color: "#00B0FF" },
              { label: "Current Price", val: fmt(price), color: "#FFB800" },
              { label: "Round Level", val: fmt(Math.round(price / 10) * 10), color: "#6B8099" },
              { label: "Session Low", val: fmt(price - 7.60), color: "#00B0FF" },
              { label: "Prev Day Low", val: fmt(price - 15.80), color: "#00E676" },
            ].map(level => (
              <div key={level.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "#6B8099" }}>{level.label}</span>
                <span className="mono" style={{ fontSize: 12, color: level.color }}>{level.val}</span>
              </div>
            ))}
          </div>

          {/* Session Metrics */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>SESSION METRICS</div>
            {[
              { label: "Win Rate", val: trades.length > 0 ? `${Math.round((trades.filter(t => ["TP1","TP2"].includes(t.status)).length / Math.max(1, trades.filter(t => t.status !== "OPEN").length)) * 100)}%` : "—", color: "#00E676" },
              { label: "Trades Today", val: `${account.tradesCount}/3`, color: maxTradesHit ? "#FF1744" : "#FFB800" },
              { label: "Daily P&L", val: fmtUSD(account.dailyPnl), color: account.dailyPnl >= 0 ? "#00E676" : "#FF1744" },
              { label: "Daily Limit Left", val: `$${fmt(Math.max(0, 6 + account.dailyPnl))}`, color: "#6B8099" },
              { label: "Checklist", val: `${checklistDone}/${checklist.length}`, color: checklistDone === checklist.length ? "#00E676" : "#FFB800" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "#6B8099" }}>{item.label}</span>
                <span className="mono" style={{ fontSize: 11, color: item.color }}>{item.val}</span>
              </div>
            ))}
          </div>

          {/* Iron Rules */}
          <div style={{ background: "rgba(255,23,68,0.05)", border: "1px solid rgba(255,23,68,0.2)", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#FF1744", letterSpacing: "0.15em", marginBottom: 6 }}>IRON RULES</div>
            {["Lot size MUST match session multiplier", "Max 3 trades/day — all sessions combined", "$6 daily loss limit — no exceptions", "News spike: wait for close, then enter", "Asian session: smallest lots or skip"].map((rule, i) => (
              <div key={i} style={{ fontSize: 11, color: "#E8F0F8", marginBottom: 4, display: "flex", gap: 6 }}>
                <span style={{ color: "#FF1744" }}>✗</span>{rule}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ background: "#080C10", borderTop: "1px solid #141C24", padding: "6px 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#6B8099" }}>XAUUSD COMMAND · 24/7 ADAPTIVE STRATEGY · $100 · 1:1000 LEVERAGE</span>
        <span style={{ fontSize: 10, color: "#6B8099" }}>⚠ SIMULATION ONLY — NOT FINANCIAL ADVICE — TRADE AT YOUR OWN RISK</span>
      </div>
    </div>
  );
}
