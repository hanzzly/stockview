import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "..", "data", "idx.csv");

export let WATCHLIST = [];
export let COMPANY = {};
export let SECTOR_MAP = {};

try {
  const raw = fs.readFileSync(csvPath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  lines.shift();
  for (const line of lines) {
    const cols = line.split(",");
    const ticker = String(cols[1] || "").trim().toUpperCase();
    if (!ticker) continue;
    WATCHLIST.push(ticker);
    COMPANY[ticker] = (cols[2] || ticker).trim();
    SECTOR_MAP[ticker] = {
      sector: (cols[5] || "Unknown").trim(),
      industry: "IDX Listed"
    };
  }
  WATCHLIST = [...new Set(WATCHLIST)];
  console.log(`Loaded ${WATCHLIST.length} saham dari CSV`);
} catch (err) {
  console.error("Gagal load CSV:", err.message);
}

// ── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Math helpers ─────────────────────────────────────────────────────────────
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function sma(values, period) {
  if (values.length < period) return avg(values);
  return avg(values.slice(-period));
}
function ema(values, period) {
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) result = values[i] * k + result * (1 - k);
  return result;
}

// ── RSI (Wilder's Smoothed MA) ────────────────────────────────────────────────
function calcRSI(values, period = 14) {
  if (values.length < period + 1) return 50;
  const changes = [];
  for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i - 1]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ── MACD (EMA 12/26 + Signal EMA 9) ──────────────────────────────────────────
function calcMACD(values) {
  if (values.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const macdLine = ema(values, 12) - ema(values, 26);
  const macdSeries = [];
  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);
    macdSeries.push(ema(slice, 12) - ema(slice, 26));
  }
  const signalLine = macdSeries.length >= 9 ? ema(macdSeries, 9) : macdSeries.at(-1);
  return { macd: macdLine, signal: signalLine, histogram: macdLine - signalLine };
}

// ── ATR (Average True Range) ──────────────────────────────────────────────────
function calcATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1) return null;
  const trValues = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trValues.push(tr);
  }
  return sma(trValues, period);
}

// ── Bollinger Bands (SMA20 ± 2σ) ─────────────────────────────────────────────
function calcBollingerBands(values, period = 20, stdDev = 2) {
  if (values.length < period) {
    const mid = avg(values);
    return { upper: mid, middle: mid, lower: mid, bandwidth: 0, percentB: 50 };
  }
  const slice  = values.slice(-period);
  const middle = avg(slice);
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / period;
  const sigma  = Math.sqrt(variance);
  const upper  = middle + stdDev * sigma;
  const lower  = middle - stdDev * sigma;
  const last   = values.at(-1);
  const bandwidth = sigma > 0 ? ((upper - lower) / middle) * 100 : 0;
  const percentB  = (upper - lower) > 0 ? ((last - lower) / (upper - lower)) * 100 : 50;
  return { upper, middle, lower, bandwidth, percentB: Math.max(0, Math.min(100, percentB)) };
}

// ── Stochastic %K/%D ──────────────────────────────────────────────────────────
function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  if (closes.length < kPeriod) return { k: 50, d: 50 };
  const recentHighs  = highs.slice(-kPeriod);
  const recentLows   = lows.slice(-kPeriod);
  const highestHigh  = Math.max(...recentHighs);
  const lowestLow    = Math.min(...recentLows);
  const range        = highestHigh - lowestLow;
  const currentClose = closes.at(-1);
  const k = range > 0 ? ((currentClose - lowestLow) / range) * 100 : 50;

  // %D = SMA(3) dari %K (rolling)
  const kSeries = [];
  const startIdx = Math.max(0, closes.length - kPeriod - dPeriod + 1);
  for (let i = startIdx; i < closes.length; i++) {
    const sl = closes.slice(Math.max(0, i - kPeriod + 1), i + 1);
    const sh = highs.slice(Math.max(0, i - kPeriod + 1), i + 1);
    const sl2 = lows.slice(Math.max(0, i - kPeriod + 1), i + 1);
    const hh = Math.max(...sh);
    const ll = Math.min(...sl2);
    const r2 = hh - ll;
    kSeries.push(r2 > 0 ? ((sl.at(-1) - ll) / r2) * 100 : 50);
  }
  const d = kSeries.length >= dPeriod ? avg(kSeries.slice(-dPeriod)) : k;
  return { k: Math.max(0, Math.min(100, k)), d: Math.max(0, Math.min(100, d)) };
}

// ── Fetch utama ───────────────────────────────────────────────────────────────
export async function fetchYahooData(ticker, interval = "1d", range = "3mo") {
  const clean = String(ticker || "")
    .trim().toUpperCase()
    .replace(/\.JK$/i, "")
    .replace(/[^A-Z0-9]/g, "");
  const symbol = `${clean}.JK`;

  const cacheKey = `${symbol}_${interval}_${range}`;
  const ttl = interval === "1d" ? 5 * 60 * 1000 : 30 * 60 * 1000;
  const cached = cacheGet(cacheKey);
  if (cached) { console.log(`[cache hit] ${symbol}`); return cached; }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}`;
  const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });

  if (!resp.ok) {
    if (resp.status === 429) throw new Error(`Rate limit Yahoo Finance untuk ${clean}, coba lagi sebentar`);
    if (resp.status === 404) throw new Error(`Ticker ${clean} tidak ditemukan di Yahoo Finance`);
    throw new Error(`Gagal mengambil data ${clean} (HTTP ${resp.status})`);
  }

  const json   = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Data ${clean} tidak tersedia`);

  const meta       = result.meta || {};
  const quote      = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];

  const rows = timestamps.map((ts, i) => ({
    time:   ts,
    date:   new Date(ts * 1000).toISOString().slice(0, 10),
    open:   quote.open?.[i]   ?? null,
    high:   quote.high?.[i]   ?? null,
    low:    quote.low?.[i]    ?? null,
    close:  quote.close?.[i]  ?? null,
    volume: quote.volume?.[i] ?? null
  })).filter(r => Number.isFinite(r.close));

  if (rows.length < 20) throw new Error(`Data ${clean} kurang (${rows.length} candle)`);

  const closes  = rows.map(r => r.close);
  const highs   = rows.map(r => r.high  ?? r.close);
  const lows    = rows.map(r => r.low   ?? r.close);
  const volumes = rows.map(r => r.volume || 0);

  const price = meta.regularMarketPrice ?? closes.at(-1);
  const prev  = meta.previousClose      ?? closes.at(-2);

  const ma5  = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);

  const rsi        = calcRSI(closes, 14);
  const macdResult = calcMACD(closes);
  const atr        = calcATR(highs, lows, closes, 14);
  const bb         = calcBollingerBands(closes, 20, 2);
  const stoch      = calcStochastic(highs, lows, closes, 14, 3);

  // ATR-based target & stop loss
  const atrMultiplier = 2.0;
  const target   = atr ? Math.round(price + atr * atrMultiplier * 1.5) : Math.round(price * 1.08);
  const stopLoss = atr ? Math.round(price - atr * atrMultiplier)        : Math.round(price * 0.96);

  // Risk/Reward Ratio
  const potentialGain = target - price;
  const potentialRisk = price - stopLoss;
  const rrRatio = potentialRisk > 0 ? +(potentialGain / potentialRisk).toFixed(2) : null;

  const volNow     = volumes.at(-1);
  const volAvg     = sma(volumes, 20);
  const volumeRatio = volAvg > 0 ? volNow / volAvg : 1;

  // ── Scoring engine v5 ────────────────────────────────────────────────────
  let score = 50;
  const reasons = [];

  // MA trend
  if (price > ma20) { score += 12; reasons.push("Harga di atas MA20"); }
  else              { score -= 10; reasons.push("Harga di bawah MA20"); }

  if (ma5 > ma20)   { score +=  8; reasons.push("MA5 bullish"); }
  else              { score -=  6; reasons.push("MA5 bearish"); }

  // RSI
  if      (rsi >= 45 && rsi <= 70) { score +=  8; reasons.push("RSI sehat"); }
  else if (rsi > 75)               { score -= 10; reasons.push("Overbought"); }
  else if (rsi < 30)               { score +=  8; reasons.push("Oversold"); }

  // MACD
  if      (macdResult.histogram > 0 && macdResult.macd > macdResult.signal) { score += 10; reasons.push("MACD crossover bullish"); }
  else if (macdResult.histogram < 0 && macdResult.macd < macdResult.signal) { score -= 10; reasons.push("MACD crossover bearish"); }
  else if (macdResult.macd > 0) { score += 4; reasons.push("MACD positif"); }
  else                          { score -= 4; reasons.push("MACD negatif"); }

  // Bollinger Bands
  const bbPct = bb.percentB;
  if      (bbPct > 80) { score -= 8;  reasons.push("BB upper squeeze"); }
  else if (bbPct < 20) { score += 8;  reasons.push("BB lower bounce"); }
  else if (bbPct >= 40 && bbPct <= 60) { score += 5; reasons.push("Harga di tengah BB"); }

  // Stochastic
  const sk = stoch.k;
  if      (sk > 80) { score -= 8;  reasons.push("Stoch overbought"); }
  else if (sk < 20) { score += 8;  reasons.push("Stoch oversold"); }
  else if (sk >= 40 && sk <= 60) { score += 4; reasons.push("Stoch netral"); }

  // Volume
  if      (volumeRatio > 1.5) { score += 8; reasons.push("Volume spike kuat"); }
  else if (volumeRatio > 1.1) { score += 4; reasons.push("Volume naik"); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const signal = score >= 70 ? "BUY" : score <= 42 ? "SELL" : "HOLD";

  const data = {
    ticker, company: COMPANY[clean] || clean,
    sector:   SECTOR_MAP?.[clean]?.sector   || "Unknown",
    industry: SECTOR_MAP?.[clean]?.industry || "Unknown",
    signal, score,
    price, previousClose: prev,
    changePct: prev > 0 ? ((price - prev) / prev) * 100 : 0,
    target, stopLoss, rrRatio,
    atr: atr ? Math.round(atr) : null,
    ma5, ma20, ma50,
    rsi,
    macd:          macdResult.macd,
    macdSignal:    macdResult.signal,
    macdHistogram: macdResult.histogram,
    bbUpper:    Math.round(bb.upper),
    bbMiddle:   Math.round(bb.middle),
    bbLower:    Math.round(bb.lower),
    bbBandwidth: +bb.bandwidth.toFixed(2),
    bbPercentB:  +bb.percentB.toFixed(1),
    stochK: +stoch.k.toFixed(1),
    stochD: +stoch.d.toFixed(1),
    volumeRatio,
    reason:    reasons.join(" · "),
    sparkline: closes.slice(-30),
    lastDate:  rows.at(-1)?.date || "-"
  };

  cacheSet(cacheKey, data, ttl);
  return data;
}
