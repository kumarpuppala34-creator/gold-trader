"use client";
import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
interface Candle { time: number; open: number; high: number; low: number; close: number; }
interface Trade { id: number; type: "LONG" | "SHORT"; entry: number; sl: number; tp1: number; tp2: number; lot: number; risk: number; status: "OPEN" | "TP1" | "TP2" | "SL" | "BE"; pnl: number; time: string; }
interface Signal { confluence: number; direction: "LONG" | "SHORT" | "WAIT"; ema: boolean; rsi: boolean; structure: boolean; rsiVal: number; emaStack: string; reason: string; }
interface ChecklistItem { id: string; label: string; done: boolean; }

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number, d = 2) => n.toFixed(d);
const fmtUSD = (n: number) => (n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(2);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function goldPrice(base: number, t: number): number {
  const noise = Math.sin(t * 0.7) * 4 + Math.sin(t * 1.3) * 2 + Math.sin(t * 0.2) * 8 + Math.random() * 1.5 - 0.75;
  return base + noise;
}

function calcLot(risk: number, sl: number): string {
  const pipVal = 0.01;
  const lot = risk / (sl * pipVal * 100);
  return Math.floor(lot * 100) / 100 < 0.01 ? "0.01" : (Math.floor(lot * 100) / 100).toFixed(2);
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

  if (emaOk && rsiOkLong && structureSwept) {
    return { confluence: 3, direction: "LONG", ema: true, rsi: true, structure: true, rsiVal, emaStack: "Bullish", reason: "Liquidity sweep + EMA aligned + RSI momentum" };
  } else if (emaOkShort && rsiOkShort && structureSwept) {
    return { confluence: 2, direction: "SHORT", ema: true, rsi: true, structure: false, rsiVal, emaStack: "Bearish", reason: "EMA bearish stack + RSI below 50" };
  } else {
    const c = (emaOk || emaOkShort ? 1 : 0) + (rsiOkLong || rsiOkShort ? 1 : 0) + (structureSwept ? 1 : 0);
    return { confluence: c, direction: "WAIT", ema: emaOk || emaOkShort, rsi: rsiOkLong || rsiOkShort, structure: structureSwept, rsiVal, emaStack: "Neutral", reason: "Insufficient confluence — wait for setup" };
  }
}

// ── Default checklist ────────────────────────────────────────────────────────
const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "c1", label: "Check economic calendar for 7:30–9 AM CT releases", done: false },
  { id: "c2", label: "Mark Asian session high & low on 1H chart", done: false },
  { id: "c3", label: "Mark previous day high & low", done: false },
  { id: "c4", label: "Identify nearest $10 round number level", done: false },
  { id: "c5", label: "Determine 1H bias — write it down", done: false },
  { id: "c6", label: "Check spread on XAU/USD — must be < 30 pips", done: false },
  { id: "c7", label: "Remind yourself: max loss today = $4.00", done: false },
  { id: "c8", label: "Watch 7:00–7:30 AM CT for liquidity sweep", done: false },
  { id: "c9", label: "Confirm 3 confluences before any entry", done: false },
  { id: "c10", label: "Hard close all positions by 9:45 AM CT", done: false },
];

// ── Mini Candle Chart ────────────────────────────────────────────────────────
function CandleChart({ candles, currentPrice }: { candles: Candle[]; currentPrice: number }) {
  const W = 600; const H = 200;
  if (candles.length < 2) return null;
  const prices = candles.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...prices); const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const toY = (p: number) => H - ((p - minP) / range) * (H - 20) - 10;
  const cw = Math.floor((W - 40) / candles.length) - 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ background: "transparent" }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={0} y1={toY(minP + f * range)} x2={W} y2={toY(minP + f * range)} stroke="#141C24" strokeWidth={1} />
      ))}
      {/* Candles */}
      {candles.map((c, i) => {
        const x = 20 + i * (cw + 1);
        const bull = c.close >= c.open;
        const color = bull ? "#00E676" : "#FF1744";
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyH = Math.max(2, Math.abs(toY(c.open) - toY(c.close)));
        return (
          <g key={i}>
            <line x1={x + cw / 2} y1={toY(c.high)} x2={x + cw / 2} y2={toY(c.low)} stroke={color} strokeWidth={1} opacity={0.7} />
            <rect x={x} y={bodyTop} width={cw} height={bodyH} fill={bull ? "#00E676" : "#FF1744"} opacity={0.85} />
          </g>
        );
      })}
      {/* Current price line */}
      <line x1={0} y1={toY(currentPrice)} x2={W} y2={toY(currentPrice)} stroke="#FFB800" strokeWidth={1} strokeDasharray="4,3" opacity={0.9} />
      <rect x={W - 70} y={toY(currentPrice) - 9} width={68} height={16} fill="#1A1200" stroke="#FFB800" strokeWidth={1} rx={2} />
      <text x={W - 36} y={toY(currentPrice) + 4} fill="#FFB800" fontSize={9} textAnchor="middle" fontFamily="'Share Tech Mono', monospace">{fmt(currentPrice, 2)}</text>
    </svg>
  );
}

// ── RSI Mini Chart ───────────────────────────────────────────────────────────
function RsiChart({ rsiHistory }: { rsiHistory: number[] }) {
  const W = 200; const H = 60;
  if (rsiHistory.length < 2) return null;
  const pts = rsiHistory.map((v, i) => `${(i / (rsiHistory.length - 1)) * W},${H - (v / 100) * H}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }}>
      <line x1={0} y1={H * 0.3} x2={W} y2={H * 0.3} stroke="#FF1744" strokeWidth={0.5} opacity={0.4} />
      <line x1={0} y1={H * 0.5} x2={W} y2={H * 0.5} stroke="#FFB800" strokeWidth={0.5} opacity={0.3} />
      <line x1={0} y1={H * 0.7} x2={W} y2={H * 0.7} stroke="#00E676" strokeWidth={0.5} opacity={0.4} />
      <polyline points={pts} fill="none" stroke="#00B0FF" strokeWidth={1.5} opacity={0.9} />
    </svg>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function GoldDashboard() {
  const BASE_PRICE = 3340.50;
  const [price, setPrice] = useState(BASE_PRICE);
  const [prevPrice, setPrevPrice] = useState(BASE_PRICE);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [signal, setSignal] = useState<Signal>({ confluence: 0, direction: "WAIT", ema: false, rsi: false, structure: false, rsiVal: 50, emaStack: "Neutral", reason: "Initializing..." });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(CHECKLIST_ITEMS);
  const [account, setAccount] = useState({ balance: 100, equity: 100, dailyPnl: 0, tradesCount: 0 });
  const [rsiHistory, setRsiHistory] = useState<number[]>([50]);
  const [sessionActive, setSessionActive] = useState(false);
  const [ctTime, setCtTime] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [tab, setTab] = useState<"chart" | "trades" | "checklist" | "rules">("chart");
  const tickRef = useRef(0);
  const candleRef = useRef<Candle>({ time: Date.now(), open: BASE_PRICE, high: BASE_PRICE, low: BASE_PRICE, close: BASE_PRICE });

  // Time update
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const ct = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
      setCtTime(ct);
      const h = parseInt(ct.split(":")[0]);
      const m = parseInt(ct.split(":")[1]);
      setSessionActive(h === 7 || h === 8 || (h === 9 && m < 45));
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, []);

  // Price feed simulation
  useEffect(() => {
    const iv = setInterval(() => {
      tickRef.current += 0.05;
      const t = tickRef.current;
      const newPrice = goldPrice(BASE_PRICE, t);
      const sig = calcSignal(newPrice, t);
      setPrevPrice(p => p);
      setPrice(prev => { setPrevPrice(prev); return newPrice; });
      setSignal(sig);
      setRsiHistory(h => [...h.slice(-49), sig.rsiVal]);

      // Update candle
      const now = Date.now();
      const CANDLE_MS = 5000;
      candleRef.current.high = Math.max(candleRef.current.high, newPrice);
      candleRef.current.low = Math.min(candleRef.current.low, newPrice);
      candleRef.current.close = newPrice;

      if (now - candleRef.current.time >= CANDLE_MS) {
        setCandles(prev => {
          const next = [...prev, { ...candleRef.current }].slice(-80);
          return next;
        });
        candleRef.current = { time: now, open: newPrice, high: newPrice, low: newPrice, close: newPrice };
      }

      // Update open trades PnL
      setTrades(prev => prev.map(tr => {
        if (tr.status !== "OPEN") return tr;
        const pips = tr.type === "LONG" ? (newPrice - tr.entry) * 10 : (tr.entry - newPrice) * 10;
        const pnl = pips * tr.lot * 0.01 * 100;
        if (tr.type === "LONG" && newPrice >= tr.tp2) return { ...tr, status: "TP2", pnl: tr.risk * 2 };
        if (tr.type === "LONG" && newPrice >= tr.tp1) return { ...tr, status: "TP1", pnl: tr.risk };
        if (tr.type === "LONG" && newPrice <= tr.sl) return { ...tr, status: "SL", pnl: -tr.risk };
        if (tr.type === "SHORT" && newPrice <= tr.tp2) return { ...tr, status: "TP2", pnl: tr.risk * 2 };
        if (tr.type === "SHORT" && newPrice <= tr.tp1) return { ...tr, status: "TP1", pnl: tr.risk };
        if (tr.type === "SHORT" && newPrice >= tr.sl) return { ...tr, status: "SL", pnl: -tr.risk };
        return { ...tr, pnl };
      }));
    }, 300);
    return () => clearInterval(iv);
  }, []);

  // Account equity from trades
  useEffect(() => {
    const closedPnl = trades.filter(t => t.status !== "OPEN").reduce((s, t) => s + t.pnl, 0);
    const openPnl = trades.filter(t => t.status === "OPEN").reduce((s, t) => s + t.pnl, 0);
    setAccount(a => ({ ...a, equity: 100 + closedPnl + openPnl, dailyPnl: closedPnl + openPnl, tradesCount: trades.length }));
  }, [trades]);

  // Place trade
  const placeTrade = useCallback((type: "LONG" | "SHORT") => {
    if (account.tradesCount >= 2 || account.dailyPnl <= -4) return;
    const slPips = 20; const risk = 2;
    const sl = type === "LONG" ? price - slPips * 0.1 : price + slPips * 0.1;
    const tp1 = type === "LONG" ? price + slPips * 0.1 : price - slPips * 0.1;
    const tp2 = type === "LONG" ? price + slPips * 0.2 : price - slPips * 0.2;
    const lot = parseFloat(calcLot(risk, slPips));
    const now = new Date();
    const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const trade: Trade = { id: Date.now(), type, entry: price, sl, tp1, tp2, lot, risk, status: "OPEN", pnl: 0, time };
    setTrades(prev => [...prev, trade]);
  }, [price, account]);

  // AI Analysis
  const getAiAnalysis = async () => {
    setAiLoading(true);
    setAiAnalysis("");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: "You are a 25-year veteran XAU/USD gold trader. Be concise, direct, and actionable. Use trading terminology. Format your response in 3 short sections: MARKET BIAS (2 sentences), SETUP QUALITY (2 sentences), ACTION PLAN (3 bullet points). Keep it under 150 words total.",
          messages: [{
            role: "user",
            content: `Current XAU/USD data:
Price: $${fmt(price, 2)}
Session: ${sessionActive ? "ACTIVE (7-10 AM CT)" : "OUTSIDE SESSION"}
CT Time: ${ctTime}
Signal Direction: ${signal.direction}
Confluence Score: ${signal.confluence}/3
EMA Stack: ${signal.emaStack}
RSI: ${fmt(signal.rsiVal, 1)}
EMA Condition: ${signal.ema ? "✓ Aligned" : "✗ Not aligned"}
RSI Condition: ${signal.rsi ? "✓ Confirmed" : "✗ Not confirmed"}
Structure: ${signal.structure ? "✓ Swept" : "✗ No sweep"}
Open Trades: ${trades.filter(t => t.status === "OPEN").length}
Daily P&L: ${fmtUSD(account.dailyPnl)}
Account: $${fmt(account.equity, 2)}

Analyze this setup and give me your professional read.`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.find((b: {type: string}) => b.type === "text")?.text || "Analysis unavailable.";
      setAiAnalysis(text);
    } catch {
      setAiAnalysis("⚠ API connection required. Connect your Anthropic API key to enable AI analysis.");
    }
    setAiLoading(false);
  };

  const priceUp = price >= prevPrice;
  const riskLimitHit = account.dailyPnl <= -4;
  const maxTradesHit = account.tradesCount >= 2;
  const checklistDone = checklist.filter(c => c.done).length;

  return (
    <div style={{ minHeight: "100vh", background: "#040608", color: "#E8F0F8" }}>

      {/* TOP BAR */}
      <div style={{ background: "#080C10", borderBottom: "1px solid #141C24", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span className="orbitron" style={{ fontSize: 14, color: "#FFB800", letterSpacing: "0.15em", fontWeight: 700 }}>XAUUSD COMMAND</span>
          <span style={{ fontSize: 11, color: "#6B8099", fontFamily: "monospace" }}>v2.5 · 25YR STRATEGY</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          {/* Live indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: sessionActive ? "#00E676" : "#FF1744" }} className={sessionActive ? "pulse-live" : ""} />
            <span style={{ fontSize: 11, color: sessionActive ? "#00E676" : "#6B8099", fontFamily: "monospace" }}>
              {sessionActive ? "SESSION ACTIVE" : "OFF SESSION"}
            </span>
          </div>

          {/* CT Clock */}
          <div style={{ textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 18, color: "#FFB800", letterSpacing: "0.1em", fontWeight: 700 }}>{ctTime || "00:00:00"}</div>
            <div style={{ fontSize: 9, color: "#6B8099", letterSpacing: "0.1em" }}>CHICAGO TIME</div>
          </div>

          {/* Account */}
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 16, color: account.equity >= 100 ? "#00E676" : "#FF1744" }}>${fmt(account.equity, 2)}</div>
            <div style={{ fontSize: 9, color: "#6B8099" }}>EQUITY</div>
          </div>
        </div>
      </div>

      {/* PRICE TICKER */}
      <div style={{ background: "#0A0E14", borderBottom: "1px solid #141C24", padding: "6px 1.5rem", display: "flex", alignItems: "center", gap: "2rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#6B8099" }}>XAU/USD</span>
          <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: priceUp ? "#00E676" : "#FF1744", transition: "color 0.3s" }}>{fmt(price, 2)}</span>
          <span style={{ fontSize: 13, color: priceUp ? "#00E676" : "#FF1744" }}>{priceUp ? "▲" : "▼"} {fmt(Math.abs(price - BASE_PRICE), 2)}</span>
        </div>
        <div style={{ display: "flex", gap: "1.5rem", fontSize: 11, color: "#6B8099" }}>
          <span>BID <span className="mono" style={{ color: "#E8F0F8" }}>{fmt(price - 0.15, 2)}</span></span>
          <span>ASK <span className="mono" style={{ color: "#E8F0F8" }}>{fmt(price + 0.15, 2)}</span></span>
          <span>SPREAD <span className="mono" style={{ color: "#FFB800" }}>0.30</span></span>
          <span>ATR <span className="mono" style={{ color: "#00B0FF" }}>12.4</span></span>
        </div>

        {/* Risk warnings */}
        {riskLimitHit && <div style={{ marginLeft: "auto", padding: "2px 10px", border: "1px solid #FF1744", borderRadius: 2, fontSize: 11, color: "#FF1744" }}>⛔ DAILY LOSS LIMIT HIT — STOP TRADING</div>}
        {!riskLimitHit && maxTradesHit && <div style={{ marginLeft: "auto", padding: "2px 10px", border: "1px solid #FFB800", borderRadius: 2, fontSize: 11, color: "#FFB800" }}>⚠ MAX 2 TRADES REACHED TODAY</div>}
      </div>

      {/* MAIN LAYOUT */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 260px", gap: "1px", background: "#141C24", minHeight: "calc(100vh - 120px)" }}>

        {/* LEFT PANEL */}
        <div style={{ background: "#080C10", padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Signal Card */}
          <div style={{ background: "#0C1117", border: `1px solid ${signal.direction === "LONG" ? "rgba(0,230,118,0.4)" : signal.direction === "SHORT" ? "rgba(255,23,68,0.4)" : "rgba(255,184,0,0.2)"}`, borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 6 }}>SIGNAL ANALYSIS</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div className="orbitron" style={{ fontSize: 20, fontWeight: 700, color: signal.direction === "LONG" ? "#00E676" : signal.direction === "SHORT" ? "#FF1744" : "#FFB800" }}>
                {signal.direction}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#6B8099" }}>CONFLUENCE</div>
                <div className="mono" style={{ fontSize: 20, color: signal.confluence >= 3 ? "#00E676" : signal.confluence >= 2 ? "#FFB800" : "#6B8099" }}>{signal.confluence}/3</div>
              </div>
            </div>

            {/* Confluence checks */}
            {[
              { label: "EMA Stack", ok: signal.ema, detail: signal.emaStack },
              { label: "RSI Confirm", ok: signal.rsi, detail: fmt(signal.rsiVal, 1) },
              { label: "Structure", ok: signal.structure, detail: signal.structure ? "Swept" : "Pending" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <span style={{ color: item.ok ? "#00E676" : "#FF1744", fontSize: 14 }}>{item.ok ? "✓" : "✗"}</span>
                  <span style={{ color: "#6B8099" }}>{item.label}</span>
                </div>
                <span className="mono" style={{ fontSize: 11, color: item.ok ? "#E8F0F8" : "#6B8099" }}>{item.detail}</span>
              </div>
            ))}

            <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(255,184,0,0.05)", borderRadius: 2, fontSize: 11, color: "#FFB800", lineHeight: 1.4 }}>
              {signal.reason}
            </div>
          </div>

          {/* RSI */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em" }}>RSI (14)</span>
              <span className="mono" style={{ fontSize: 14, color: signal.rsiVal > 70 ? "#FF1744" : signal.rsiVal < 30 ? "#00E676" : "#00B0FF" }}>{fmt(signal.rsiVal, 1)}</span>
            </div>
            <RsiChart rsiHistory={rsiHistory} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#6B8099", marginTop: 2 }}>
              <span style={{ color: "#00E676" }}>30 OVERSOLD</span>
              <span style={{ color: "#FFB800" }}>50 MID</span>
              <span style={{ color: "#FF1744" }}>70 OB</span>
            </div>
          </div>

          {/* Lot Calc */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>LOT SIZE CALCULATOR</div>
            {[15, 20, 25, 30].map(sl => (
              <div key={sl} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                <span style={{ color: "#6B8099" }}>SL {sl} pips</span>
                <span className="mono" style={{ color: "#FFB800" }}>{calcLot(2, sl)} lot</span>
                <span className="mono" style={{ color: "#00E676" }}>$2.00 risk</span>
              </div>
            ))}
          </div>

          {/* Account Stats */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>ACCOUNT</div>
            {[
              { label: "Capital", val: "$100.00", color: "#6B8099" },
              { label: "Leverage", val: "1:1000", color: "#00B0FF" },
              { label: "Equity", val: `$${fmt(account.equity, 2)}`, color: account.equity >= 100 ? "#00E676" : "#FF1744" },
              { label: "Daily P&L", val: fmtUSD(account.dailyPnl), color: account.dailyPnl >= 0 ? "#00E676" : "#FF1744" },
              { label: "Trades Today", val: `${account.tradesCount}/2`, color: maxTradesHit ? "#FF1744" : "#FFB800" },
              { label: "Max Risk/Trade", val: "$2.00 (2%)", color: "#6B8099" },
              { label: "Daily Loss Limit", val: "$4.00 (4%)", color: "#6B8099" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 12 }}>
                <span style={{ color: "#6B8099" }}>{item.label}</span>
                <span className="mono" style={{ color: item.color }}>{item.val}</span>
              </div>
            ))}
            {/* Loss limit bar */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: "#6B8099", marginBottom: 3 }}>DAILY LOSS BUFFER</div>
              <div style={{ height: 4, background: "#141C24", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${clamp(((4 + account.dailyPnl) / 4) * 100, 0, 100)}%`, background: account.dailyPnl > -2 ? "#00E676" : "#FF1744", transition: "width 0.5s" }} />
              </div>
              <div className="mono" style={{ fontSize: 9, color: "#6B8099", marginTop: 2 }}>
                ${fmt(Math.max(0, 4 + account.dailyPnl), 2)} remaining
              </div>
            </div>
          </div>
        </div>

        {/* CENTER PANEL */}
        <div style={{ background: "#080C10", display: "flex", flexDirection: "column" }}>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #141C24" }}>
            {(["chart", "trades", "checklist", "rules"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 20px", fontSize: 11, letterSpacing: "0.1em", fontFamily: "inherit", border: "none", cursor: "pointer", borderBottom: tab === t ? "2px solid #FFB800" : "2px solid transparent", background: tab === t ? "rgba(255,184,0,0.05)" : "transparent", color: tab === t ? "#FFB800" : "#6B8099", textTransform: "uppercase", fontWeight: 600 }}>
                {t}
              </button>
            ))}
          </div>

          {/* Chart Tab */}
          {tab === "chart" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "1rem", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#6B8099" }}>XAU/USD · 5M SIMULATION</span>
                <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                  <span style={{ color: "#FFD54F" }}>━ EMA 9</span>
                  <span style={{ color: "#FF8F00" }}>━ EMA 21</span>
                  <span style={{ color: "#FF1744" }}>━ EMA 50</span>
                </div>
              </div>
              <div style={{ flex: 1, background: "#040608", border: "1px solid #141C24", borderRadius: 2, overflow: "hidden", minHeight: 200 }}>
                <CandleChart candles={candles} currentPrice={price} />
              </div>

              {/* Trade buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button onClick={() => placeTrade("LONG")} disabled={maxTradesHit || riskLimitHit} style={{ padding: "14px", background: maxTradesHit || riskLimitHit ? "#0C1117" : "rgba(0,230,118,0.1)", border: `1px solid ${maxTradesHit || riskLimitHit ? "#141C24" : "rgba(0,230,118,0.5)"}`, borderRadius: 2, color: maxTradesHit || riskLimitHit ? "#6B8099" : "#00E676", fontSize: 14, fontWeight: 700, cursor: maxTradesHit || riskLimitHit ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "0.1em", transition: "all 0.2s" }}>
                  ▲ LONG XAU/USD
                </button>
                <button onClick={() => placeTrade("SHORT")} disabled={maxTradesHit || riskLimitHit} style={{ padding: "14px", background: maxTradesHit || riskLimitHit ? "#0C1117" : "rgba(255,23,68,0.1)", border: `1px solid ${maxTradesHit || riskLimitHit ? "#141C24" : "rgba(255,23,68,0.5)"}`, borderRadius: 2, color: maxTradesHit || riskLimitHit ? "#6B8099" : "#FF1744", fontSize: 14, fontWeight: 700, cursor: maxTradesHit || riskLimitHit ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "0.1em", transition: "all 0.2s" }}>
                  ▼ SHORT XAU/USD
                </button>
              </div>
              <div style={{ fontSize: 10, color: "#6B8099", textAlign: "center" }}>SL: 20 pips · TP1: 1:1 · TP2: 2:1 · Risk: $2.00 per trade · Max 2 trades/session</div>

              {/* AI Analysis */}
              <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em" }}>AI MARKET ANALYSIS</span>
                  <button onClick={getAiAnalysis} disabled={aiLoading} style={{ padding: "4px 12px", background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.3)", borderRadius: 2, color: "#FFB800", fontSize: 11, cursor: aiLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                    {aiLoading ? "ANALYZING..." : "GET ANALYSIS"}
                  </button>
                </div>
                {aiLoading && <div style={{ fontSize: 11, color: "#6B8099" }}>Consulting 25-year strategy engine<span className="blink">▋</span></div>}
                {aiAnalysis && <div style={{ fontSize: 12, color: "#E8F0F8", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{aiAnalysis}</div>}
                {!aiAnalysis && !aiLoading && <div style={{ fontSize: 11, color: "#6B8099" }}>Click &quot;Get Analysis&quot; for AI-powered market read based on current conditions.</div>}
              </div>
            </div>
          )}

          {/* Trades Tab */}
          {tab === "trades" && (
            <div style={{ flex: 1, padding: "1rem" }}>
              <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 12 }}>TRADE LOG — TODAY&apos;S SESSION</div>
              {trades.length === 0 && (
                <div style={{ textAlign: "center", padding: "3rem", color: "#6B8099", fontSize: 13 }}>No trades yet this session.<br /><span style={{ fontSize: 11 }}>Wait for 3-confluence setup before entering.</span></div>
              )}
              {trades.map(tr => (
                <div key={tr.id} className="slide-in" style={{ background: "#0C1117", border: `1px solid ${tr.status === "TP2" ? "rgba(0,230,118,0.4)" : tr.status === "TP1" ? "rgba(0,230,118,0.2)" : tr.status === "SL" ? "rgba(255,23,68,0.3)" : "rgba(255,184,0,0.2)"}`, borderRadius: 2, padding: "0.75rem", marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 2, fontSize: 11, fontWeight: 700, background: tr.type === "LONG" ? "rgba(0,230,118,0.15)" : "rgba(255,23,68,0.15)", color: tr.type === "LONG" ? "#00E676" : "#FF1744" }}>{tr.type}</span>
                      <span className="mono" style={{ fontSize: 11, color: "#6B8099" }}>{tr.time}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="mono" style={{ fontSize: 13, color: tr.pnl >= 0 ? "#00E676" : "#FF1744", fontWeight: 700 }}>{fmtUSD(tr.pnl)}</span>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 2, background: tr.status === "OPEN" ? "rgba(255,184,0,0.1)" : tr.status === "SL" ? "rgba(255,23,68,0.1)" : "rgba(0,230,118,0.1)", color: tr.status === "OPEN" ? "#FFB800" : tr.status === "SL" ? "#FF1744" : "#00E676" }}>{tr.status}</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, fontSize: 10 }}>
                    {[
                      { l: "Entry", v: fmt(tr.entry, 2) },
                      { l: "SL", v: fmt(tr.sl, 2) },
                      { l: "TP1", v: fmt(tr.tp1, 2) },
                      { l: "TP2", v: fmt(tr.tp2, 2) },
                      { l: "Lot", v: tr.lot.toFixed(2) },
                    ].map(item => (
                      <div key={item.l}>
                        <div style={{ color: "#6B8099" }}>{item.l}</div>
                        <div className="mono" style={{ color: "#E8F0F8" }}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {/* Summary */}
              {trades.length > 0 && (
                <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem", marginTop: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 12 }}>
                    <div>
                      <div style={{ color: "#6B8099", fontSize: 10 }}>WIN RATE</div>
                      <div className="mono" style={{ color: "#00E676" }}>
                        {trades.length > 0 ? Math.round((trades.filter(t => ["TP1", "TP2"].includes(t.status)).length / Math.max(1, trades.filter(t => t.status !== "OPEN").length)) * 100) : 0}%
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#6B8099", fontSize: 10 }}>CLOSED P&L</div>
                      <div className="mono" style={{ color: trades.filter(t => t.status !== "OPEN").reduce((s, t) => s + t.pnl, 0) >= 0 ? "#00E676" : "#FF1744" }}>
                        {fmtUSD(trades.filter(t => t.status !== "OPEN").reduce((s, t) => s + t.pnl, 0))}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#6B8099", fontSize: 10 }}>TOTAL TRADES</div>
                      <div className="mono" style={{ color: "#FFB800" }}>{trades.length}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Checklist Tab */}
          {tab === "checklist" && (
            <div style={{ flex: 1, padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em" }}>PRE-SESSION CHECKLIST</span>
                <span className="mono" style={{ fontSize: 13, color: checklistDone === checklist.length ? "#00E676" : "#FFB800" }}>{checklistDone}/{checklist.length}</span>
              </div>
              <div style={{ height: 4, background: "#141C24", borderRadius: 2, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ height: "100%", width: `${(checklistDone / checklist.length) * 100}%`, background: checklistDone === checklist.length ? "#00E676" : "#FFB800", transition: "width 0.3s" }} />
              </div>
              {checklist.map((item) => (
                <div key={item.id} onClick={() => setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, done: !c.done } : c))} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 8px", marginBottom: 4, cursor: "pointer", background: item.done ? "rgba(0,230,118,0.05)" : "transparent", border: `1px solid ${item.done ? "rgba(0,230,118,0.2)" : "#141C24"}`, borderRadius: 2, transition: "all 0.2s" }}>
                  <div style={{ width: 18, height: 18, border: `1px solid ${item.done ? "#00E676" : "#6B8099"}`, borderRadius: 2, background: item.done ? "#00E676" : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1, transition: "all 0.2s" }}>
                    {item.done && <span style={{ color: "#040608", fontSize: 12, fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 13, color: item.done ? "#6B8099" : "#E8F0F8", textDecoration: item.done ? "line-through" : "none", lineHeight: 1.4 }}>{item.label}</span>
                </div>
              ))}
              <button onClick={() => setChecklist(CHECKLIST_ITEMS)} style={{ marginTop: 12, width: "100%", padding: "8px", background: "transparent", border: "1px solid #141C24", borderRadius: 2, color: "#6B8099", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                RESET CHECKLIST
              </button>
            </div>
          )}

          {/* Rules Tab */}
          {tab === "rules" && (
            <div style={{ flex: 1, padding: "1rem", overflowY: "auto" }}>
              <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 12 }}>STRATEGY RULES — QUICK REFERENCE</div>
              {[
                { title: "SESSION WINDOW", color: "#00B0FF", rules: ["Trade ONLY 7:00–9:45 AM CT", "Hard close ALL positions by 9:45 AM CT", "Do NOT trade before 7:00 AM CT"] },
                { title: "ENTRY — 3 CONFLUENCES REQUIRED", color: "#FFB800", rules: ["1. EMA Stack: 9 > 21 > 50 (long) or 9 < 21 < 50 (short)", "2. RSI: Above 50 & rising < 70 (long) OR below 50 & falling > 30 (short)", "3. Liquidity sweep of Asian session high or low + reversal signal"] },
                { title: "STOP LOSS", color: "#FF1744", rules: ["Place 5 pips beyond the signal candle wick", "Minimum SL: 15 pips — never tighter", "Maximum SL: 30 pips — skip setup if wider needed"] },
                { title: "TAKE PROFIT", color: "#00E676", rules: ["TP1 = 1:1 R/R — close 50% of position", "Move SL to breakeven after TP1 hit", "TP2 = 2:1 R/R — close remaining 50%"] },
                { title: "RISK RULES", color: "#FF1744", rules: ["Risk exactly 2% ($2.00) per trade", "Max 2 trades per session — no exceptions", "Daily loss limit: $4.00 — stop if hit", "Balance < $80: switch to demo immediately"] },
              ].map(section => (
                <div key={section.title} style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem", marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: section.color, letterSpacing: "0.15em", marginBottom: 6, fontWeight: 700 }}>{section.title}</div>
                  {section.rules.map((rule, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4, fontSize: 12, color: "#E8F0F8", lineHeight: 1.4 }}>
                      <span style={{ color: section.color, flexShrink: 0 }}>›</span>
                      <span>{rule}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ background: "#080C10", padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* Session Timer */}
          <div style={{ background: "#0C1117", border: `1px solid ${sessionActive ? "rgba(0,230,118,0.3)" : "rgba(255,184,0,0.2)"}`, borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 6 }}>SESSION STATUS</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: sessionActive ? "#00E676" : "#FFB800", marginBottom: 4 }}>
              {sessionActive ? "🟢 TRADING WINDOW OPEN" : "🟡 OUTSIDE TRADING HOURS"}
            </div>
            <div style={{ fontSize: 11, color: "#6B8099" }}>Session: 07:00 – 09:45 CT</div>
            <div style={{ fontSize: 11, color: "#6B8099" }}>Hard close: 09:45 CT</div>
            {!sessionActive && <div style={{ marginTop: 6, fontSize: 11, color: "#FFB800" }}>Prepare levels and bias before 07:00</div>}
          </div>

          {/* Key Levels */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>KEY PRICE LEVELS</div>
            {[
              { label: "Prev Day High", val: fmt(price + 18.40, 2), color: "#FF1744" },
              { label: "Asian High", val: fmt(price + 8.20, 2), color: "#00B0FF" },
              { label: "Current Price", val: fmt(price, 2), color: "#FFB800" },
              { label: "Round Level", val: fmt(Math.round(price / 10) * 10, 2), color: "#6B8099" },
              { label: "Asian Low", val: fmt(price - 7.60, 2), color: "#00B0FF" },
              { label: "Prev Day Low", val: fmt(price - 15.80, 2), color: "#00E676" },
            ].map(level => (
              <div key={level.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#6B8099" }}>{level.label}</span>
                <span className="mono" style={{ fontSize: 12, color: level.color }}>{level.val}</span>
              </div>
            ))}
          </div>

          {/* Economic Calendar */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>ECON CALENDAR · TODAY</div>
            {[
              { time: "07:30", event: "Jobless Claims", impact: "MED", color: "#FFB800" },
              { time: "08:30", event: "CPI m/m", impact: "HIGH", color: "#FF1744" },
              { time: "09:00", event: "Fed Speaker", impact: "MED", color: "#FFB800" },
            ].map(ev => (
              <div key={ev.event} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 11 }}>
                <span className="mono" style={{ color: "#6B8099", flexShrink: 0 }}>{ev.time}</span>
                <span style={{ color: "#E8F0F8", flex: 1 }}>{ev.event}</span>
                <span style={{ padding: "1px 5px", borderRadius: 2, fontSize: 9, fontWeight: 700, background: ev.impact === "HIGH" ? "rgba(255,23,68,0.15)" : "rgba(255,184,0,0.1)", color: ev.color }}>{ev.impact}</span>
              </div>
            ))}
            <div style={{ marginTop: 6, fontSize: 10, color: "#6B8099" }}>⚠ Wait for spike to complete before entering on HIGH impact</div>
          </div>

          {/* Performance Metrics */}
          <div style={{ background: "#0C1117", border: "1px solid #141C24", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#6B8099", letterSpacing: "0.15em", marginBottom: 8 }}>SESSION METRICS</div>
            {[
              { label: "Win Rate", val: trades.length > 0 ? `${Math.round((trades.filter(t => ["TP1", "TP2"].includes(t.status)).length / Math.max(1, trades.filter(t => t.status !== "OPEN").length)) * 100)}%` : "—", color: "#00E676" },
              { label: "Trades Taken", val: `${account.tradesCount}/2`, color: maxTradesHit ? "#FF1744" : "#FFB800" },
              { label: "Session P&L", val: fmtUSD(account.dailyPnl), color: account.dailyPnl >= 0 ? "#00E676" : "#FF1744" },
              { label: "Risk Used", val: `$${fmt(Math.abs(account.dailyPnl < 0 ? account.dailyPnl : 0), 2)} / $4.00`, color: "#6B8099" },
              { label: "Checklist", val: `${checklistDone}/${checklist.length} done`, color: checklistDone === checklist.length ? "#00E676" : "#FFB800" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: "#6B8099" }}>{item.label}</span>
                <span className="mono" style={{ fontSize: 11, color: item.color }}>{item.val}</span>
              </div>
            ))}
          </div>

          {/* Quick Rules */}
          <div style={{ background: "rgba(255,23,68,0.05)", border: "1px solid rgba(255,23,68,0.2)", borderRadius: 2, padding: "0.75rem" }}>
            <div style={{ fontSize: 10, color: "#FF1744", letterSpacing: "0.15em", marginBottom: 6 }}>IRON RULES</div>
            {["Never risk more than $2/trade", "3 confluences MINIMUM to enter", "Hard close by 9:45 AM CT", "Stop at $4 daily loss — no exceptions", "Never move SL against your trade"].map((rule, i) => (
              <div key={i} style={{ fontSize: 11, color: "#E8F0F8", marginBottom: 4, display: "flex", gap: 6 }}>
                <span style={{ color: "#FF1744" }}>✗</span>{rule}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ background: "#080C10", borderTop: "1px solid #141C24", padding: "6px 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#6B8099" }}>XAU/USD COMMAND TERMINAL · 25YR STRATEGY · $100 · 1:1000 LEVERAGE</span>
        <span style={{ fontSize: 10, color: "#6B8099" }}>⚠ SIMULATION ONLY — NOT FINANCIAL ADVICE — TRADE AT YOUR OWN RISK</span>
      </div>
    </div>
  );
}
