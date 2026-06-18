export default async function handler(req, res) {
  try {
    const body = req.body || {};
    const ticker = String(body.ticker || "").trim().toUpperCase();
    if (!ticker) return res.status(400).json({ ok: false, error: "Ticker tidak boleh kosong" });

    const macdInfo = body.macdHistogram != null
      ? `MACD Line: ${Number(body.macd).toFixed(2)}, Signal: ${Number(body.macdSignal).toFixed(2)}, Histogram: ${Number(body.macdHistogram).toFixed(2)}`
      : `MACD: ${Number(body.macd || 0).toFixed(2)}`;

    const atrInfo   = body.atr   ? `ATR(14): ${body.atr}` : "";
    const bbInfo    = body.bbUpper ? `BB Upper: ${body.bbUpper}, Middle: ${body.bbMiddle}, Lower: ${body.bbLower}, %B: ${body.bbPercentB}` : "";
    const stochInfo = body.stochK != null ? `Stoch %K: ${body.stochK}, %D: ${body.stochD}` : "";
    const rrInfo    = body.rrRatio != null ? `Risk/Reward: 1:${body.rrRatio}` : "";

    const prompt = `
Analisis teknikal saham Indonesia berikut.
Gunakan bahasa trader Indonesia yang singkat dan jelas.

Ticker   : ${ticker}
Signal   : ${body.signal}
Score    : ${body.score}/100
RSI(14)  : ${Number(body.rsi).toFixed(1)}
${macdInfo}
${atrInfo}
${bbInfo}
${stochInfo}
${rrInfo}
Harga    : Rp ${Number(body.price).toLocaleString("id-ID")}
Target   : Rp ${Number(body.target).toLocaleString("id-ID")}
Stop Loss: Rp ${Number(body.stopLoss).toLocaleString("id-ID")}
Vol Ratio: ${Number(body.volumeRatio).toFixed(2)}x
Alasan   : ${body.reason}

Berikan analisis singkat mencakup:
- Momentum saat ini (bullish/bearish/sideways)
- Posisi Bollinger Band dan Stochastic
- Rekomendasi entry area
- Level target dan stop loss dengan R/R ratio
- 1–2 warning risiko utama

Maksimal 150 kata. Jangan gunakan format markdown atau bullet poin.
`.trim();

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}` },
      body: JSON.stringify({ model: "deepseek/deepseek-chat", max_tokens: 250, messages: [{ role: "user", content: prompt }] })
    });

    if (!resp.ok) {
      const status = resp.status;
      console.error(`[explain] OpenRouter HTTP ${status} untuk ${ticker}`);
      if (status === 401 || status === 403) return res.status(500).json({ ok: false, error: "Layanan AI sementara tidak tersedia" });
      if (status === 429) return res.status(429).json({ ok: false, error: "Terlalu banyak permintaan AI, coba sebentar lagi" });
      return res.status(500).json({ ok: false, error: "Gagal menghubungi layanan AI" });
    }

    const json = await resp.json();
    const raw  = json?.choices?.[0]?.message?.content || "";
    if (!raw.trim()) return res.status(500).json({ ok: false, error: "AI tidak menghasilkan respons" });

    const text = raw.replace(/\*\*/g, "").replace(/\*/g, "").replace(/#{1,3}\s/g, "").trim();
    return res.status(200).json({ ok: true, text });

  } catch (err) {
    console.error("[explain] error:", err);
    return res.status(500).json({ ok: false, error: "Terjadi kesalahan server saat analisis AI" });
  }
}
