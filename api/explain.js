export default async function handler(req, res) {
  try {
    const body = req.body || {};

    // Validasi input dasar sebelum kirim ke AI
    const ticker = String(body.ticker || "").trim().toUpperCase();
    if (!ticker) {
      return res.status(400).json({ ok: false, error: "Ticker tidak boleh kosong" });
    }

    // FIX #2: Sertakan MACD Signal Line dan Histogram dalam prompt
    const macdInfo = body.macdHistogram != null
      ? `MACD Line: ${Number(body.macd).toFixed(2)}, Signal: ${Number(body.macdSignal).toFixed(2)}, Histogram: ${Number(body.macdHistogram).toFixed(2)}`
      : `MACD: ${Number(body.macd || 0).toFixed(2)}`;

    const atrInfo = body.atr ? `ATR(14): ${body.atr}` : "";

    const prompt = `
Analisis teknikal saham Indonesia berikut.
Gunakan bahasa trader Indonesia yang singkat dan jelas.

Ticker   : ${ticker}
Signal   : ${body.signal}
Score    : ${body.score}/100
RSI(14)  : ${Number(body.rsi).toFixed(1)}
${macdInfo}
${atrInfo}
Harga    : Rp ${Number(body.price).toLocaleString("id-ID")}
Target   : Rp ${Number(body.target).toLocaleString("id-ID")}
Stop Loss: Rp ${Number(body.stopLoss).toLocaleString("id-ID")}
Vol Ratio: ${Number(body.volumeRatio).toFixed(2)}x
Alasan   : ${body.reason}

Berikan analisis singkat mencakup:
- Momentum saat ini (bullish/bearish/sideways)
- Rekomendasi entry area
- Level target dan stop loss
- 1–2 warning risiko utama

Maksimal 130 kata. Jangan gunakan format markdown atau bullet poin.
`.trim();

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }]
      })
    });

    // FIX #3: Sanitasi error — jangan bocorkan detail OpenRouter ke frontend
    if (!resp.ok) {
      const status = resp.status;
      console.error(`[explain] OpenRouter HTTP ${status} untuk ${ticker}`);

      if (status === 401 || status === 403) {
        return res.status(500).json({ ok: false, error: "Layanan AI sementara tidak tersedia" });
      }
      if (status === 429) {
        return res.status(429).json({ ok: false, error: "Terlalu banyak permintaan AI, coba sebentar lagi" });
      }
      return res.status(500).json({ ok: false, error: "Gagal menghubungi layanan AI" });
    }

    const json = await resp.json();
    const raw  = json?.choices?.[0]?.message?.content || "";

    if (!raw.trim()) {
      return res.status(500).json({ ok: false, error: "AI tidak menghasilkan respons" });
    }

    // Bersihkan markdown yang mungkin masih muncul
    const text = raw
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/#{1,3}\s/g, "")
      .trim();

    return res.status(200).json({ ok: true, text });

  } catch (err) {
    // FIX #3: Jangan kirim err.message mentah ke client
    console.error("[explain] error:", err);
    return res.status(500).json({
      ok:    false,
      error: "Terjadi kesalahan server saat analisis AI"
    });
  }
}
