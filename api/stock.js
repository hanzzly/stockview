import { fetchYahooData } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const ticker   = String(req.query.ticker || "").trim().toUpperCase();
    const interval = req.query.interval || "1d";
    const range    = interval === "1d" ? "3mo" : "1y";

    if (!ticker) {
      return res.status(400).json({ ok: false, error: "Ticker wajib diisi" });
    }

    // fetchYahooData sudah handle cache, RSI Wilder, MACD Signal Line, ATR
    const analysis = await fetchYahooData(ticker, interval, range);

    return res.status(200).json({ ok: true, analysis });

  } catch (err) {
    // FIX: Sanitasi error — pesan dari fetchYahooData sudah user-friendly
    console.error("[stock] error:", err);
    return res.status(500).json({
      ok:    false,
      error: err.message || "Gagal mengambil data saham"
    });
  }
}
