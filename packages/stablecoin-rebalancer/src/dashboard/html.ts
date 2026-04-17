export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stablecoin Rebalancer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen">
  <div class="max-w-md mx-auto p-4 space-y-4">
    <header class="flex items-center justify-between">
      <h1 class="text-lg font-bold">🪙 Stablecoin Rates</h1>
      <span id="heartbeat" class="text-xs text-slate-400">...</span>
    </header>

    <section class="bg-slate-800 rounded-xl p-3">
      <div class="text-xs uppercase text-slate-400 mb-2">Current supply APY</div>
      <div id="rate-matrix" class="space-y-3 text-sm"></div>
    </section>

    <section class="bg-slate-800 rounded-xl p-3">
      <div class="text-xs uppercase text-slate-400 mb-2">Opportunities (latest 10)</div>
      <ul id="opportunities" class="space-y-2 text-sm"></ul>
    </section>

    <section class="bg-slate-800 rounded-xl p-3">
      <div class="text-xs uppercase text-slate-400 mb-2">USDC rate history (30d)</div>
      <canvas id="usdcChart" height="140"></canvas>
    </section>
  </div>

  <script>
    async function loadAll() {
      try {
        const [rates, opps, hist] = await Promise.all([
          fetch('/api/rates').then(r => r.json()),
          fetch('/api/opportunities?limit=10').then(r => r.json()),
          fetch('/api/history?asset=USDC&days=30').then(r => r.json()),
        ]);
        renderRates(rates.rates || []);
        renderOpps(opps.opportunities || []);
        renderHistory(hist.points || []);
        document.getElementById('heartbeat').textContent = new Date().toLocaleTimeString();
      } catch (e) { console.error(e); }
    }

    function renderRates(rates) {
      // Group by asset, show chain x protocol table
      const byAsset = {};
      for (const r of rates) {
        (byAsset[r.asset] ||= []).push(r);
      }
      const el = document.getElementById('rate-matrix');
      const assets = ['USDC', 'USDT', 'DAI'];
      el.innerHTML = assets.map(asset => {
        const rows = byAsset[asset] || [];
        if (!rows.length) return '<div class="text-slate-500">' + asset + ': no data</div>';
        rows.sort((a, b) => b.supply_apy - a.supply_apy);
        const rowHtml = rows.map(r =>
          '<div class="flex justify-between py-1 border-b border-slate-700">' +
          '<span class="text-slate-300">' + r.protocol + ' · ' + r.chain + '</span>' +
          '<span class="font-mono">' + (r.supply_apy*100).toFixed(2) + '%</span>' +
          '</div>'
        ).join('');
        return '<div><div class="font-semibold mb-1">' + asset + '</div>' + rowHtml + '</div>';
      }).join('');
    }

    function renderOpps(opps) {
      const el = document.getElementById('opportunities');
      if (!opps.length) {
        el.innerHTML = '<li class="text-slate-500">No opportunities above threshold yet</li>';
        return;
      }
      el.innerHTML = opps.map(o => {
        const ts = new Date(o.detected_ts).toLocaleString();
        const edgePct = (o.net_edge_bps / 100).toFixed(2);
        return '<li>' +
          '<div class="flex justify-between">' +
          '<span><b>' + o.asset + '</b> ' + o.source_protocol + '@' + o.source_chain + ' → ' + o.target_protocol + '@' + o.target_chain + '</span>' +
          '<span class="text-green-400 font-mono">+' + edgePct + '%</span>' +
          '</div>' +
          '<div class="text-xs text-slate-500">' + ts + ' · gas $' + Number(o.gas_estimate_usd).toFixed(2) + '</div>' +
          '</li>';
      }).join('');
    }

    let chart;
    function renderHistory(points) {
      const ctx = document.getElementById('usdcChart').getContext('2d');
      // Group by protocol:chain
      const series = {};
      for (const p of points) {
        const key = p.protocol + ':' + p.chain;
        (series[key] ||= []).push({ x: p.snapshot_ts, y: p.supply_apy * 100 });
      }
      const datasets = Object.entries(series).map(([label, data]) => ({
        label, data: data.sort((a, b) => a.x - b.x),
        borderWidth: 1.5, pointRadius: 0, tension: 0.2,
      }));
      if (chart) chart.destroy();
      chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true,
          scales: {
            x: { type: 'linear', ticks: { callback: v => new Date(v).toLocaleDateString() }},
            y: { title: { display: true, text: 'APY %' }},
          },
          plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 10 }}}},
        },
      });
    }

    loadAll();
    setInterval(loadAll, 60000);
  </script>
</body>
</html>`;
