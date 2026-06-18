import { WATCHLIST, fetchYahooData } from "./_lib.js";

// Jalankan promises secara paralel dengan batas konkurensi
// agar tidak flood Yahoo Finance sekaligus
async function parallelLimit(tasks, concurrency = 4) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      try {
        const value = await tasks[current]();
        results[current] = { status: "fulfilled", value };
      } catch (err) {
        results[current] = { status: "rejected", reason: err };
      }
    }
  }

  // Jalankan sejumlah `concurrency` worker sekaligus
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker)
  );

  return results;
}

export default async function handler(req, res) {
  try {
    const interval = req.query.interval || "1d";
    const range    = interval === "1d" ? "3mo" : "1y";
    const limit    = Math.min(Number(req.query.limit || 12), 20);

    const tickers = WATCHLIST.slice(0, limit);

    // FIX: jalankan paralel dengan 4 konkurensi (bukan sequential)
    // 12 ticker: ~3 detik vs sebelumnya ~20–30 detik
    const settled = await parallelLimit(
      tickers.map(t => () => fetchYahooData(t, interval, range)),
      4
    );

    const results = [];
    const errors  = [];

    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        // Sanitasi: hanya expose pesan, bukan stack trace
        errors.push(r.reason?.message || "Gagal mengambil data");
      }
    }

    results.sort((a, b) => b.score - a.score);

    return res.status(200).json({
      ok:      true,
      count:   results.length,
      failed:  errors.length,
      errors,
      results
    });

  } catch (err) {
    console.error("[analyze] error:", err);
    return res.status(500).json({
      ok:    false,
      error: "Terjadi kesalahan server, coba beberapa saat lagi"
    });
  }
}
