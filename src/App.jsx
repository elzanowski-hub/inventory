import { useState, useEffect } from "react";

function formatDate(d) {
  return new Date(d).toLocaleDateString("pl-PL", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

var box = {
  background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
  borderRadius: 16, padding: 28, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 20
};
var labelSt = { color: "#8892b0", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, display: "block", marginBottom: 5 };
var inputSt = {
  width: "100%", padding: "9px 12px", background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#ccd6f6",
  fontFamily: "monospace", fontSize: 13, outline: "none", boxSizing: "border-box",
};
var headingSt = { color: "#e0e0e0", margin: "0 0 18px", fontFamily: "monospace", fontSize: 17, letterSpacing: 1 };

export default function InventoryTracker() {
  var [cfg, setCfg] = useState({ url: "", key: "", token: "" });
  var [showCfg, setShowCfg] = useState(true);
  var [showToken, setShowToken] = useState(false);
  var [fetching, setFetching] = useState(false);
  var [fetchMsg, setFetchMsg] = useState("");
  var [fetchErr, setFetchErr] = useState("");
  var [snapshots, setSnapshots] = useState([]);
  var [selSnap, setSelSnap] = useState(null);
  var [cmpSnap, setCmpSnap] = useState(null);
  var [items, setItems] = useState([]);
  var [cmpItems, setCmpItems] = useState([]);
  var [search, setSearch] = useState("");
  var [loading, setLoading] = useState(false);
  var [sortBy, setSortBy] = useState("name");
  var [sortDir, setSortDir] = useState("asc");
  var [tab, setTab] = useState("sql");

  var canFetch = cfg.url && cfg.key && cfg.token;

  function sbPost(table, rows) {
    return fetch(cfg.url + "/rest/v1/" + table, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.key,
        Authorization: "Bearer " + cfg.key,
        Prefer: "return=representation",
      },
      body: JSON.stringify(rows),
    }).then(function(r) {
      if (!r.ok) return r.text().then(function(t) { throw new Error("Supabase " + table + ": " + r.status + " " + t); });
      return r.json();
    });
  }

  function sbGet(table, query) {
    if (!cfg.url || !cfg.key) return Promise.resolve([]);
    return fetch(cfg.url + "/rest/v1/" + table + "?" + (query || ""), {
      headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key },
    }).then(function(r) {
      if (!r.ok) return [];
      return r.json();
    });
  }

  function blCall(method, params) {
    return fetch("https://api.baselinker.com/connector.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: cfg.token,
        method: method,
        parameters: JSON.stringify(params || {}),
      }),
    }).then(function(r) { return r.json(); });
  }

  function loadSnapshots() {
    sbGet("inventory_snapshots", "order=snapshot_date.desc&limit=50").then(setSnapshots);
  }

  useEffect(function() {
    if (cfg.url && cfg.key) loadSnapshots();
  }, [cfg.url, cfg.key]);

  function fetchNow() {
    setFetching(true);
    setFetchErr("");
    setFetchMsg("Pobieram liste magazynow z BaseLinker...");

    blCall("getInventories").then(function(invData) {
      if (invData.status === "ERROR") throw new Error(invData.error_message);
      var inventories = invData.inventories || [];
      setFetchMsg("Znaleziono " + inventories.length + " magazyn(ow). Tworze snapshot...");
      return sbPost("inventory_snapshots", [{ fetched_by: "manual" }]).then(function(snapArr) {
        var snapshot = snapArr[0];
        var total = 0;

        function processInv(idx) {
          if (idx >= inventories.length) {
            setFetchMsg("Gotowe! Zapisano " + total + " produktow.");
            setFetching(false);
            loadSnapshots();
            return Promise.resolve();
          }
          var inv = inventories[idx];

          function processPage(page) {
            setFetchMsg("Magazyn " + (inv.name || inv.inventory_id) + " — strona " + page + "...");
            return blCall("getInventoryProductsList", { inventory_id: inv.inventory_id, page: page }).then(function(pd) {
              if (pd.status === "ERROR") throw new Error(pd.error_message);
              var products = pd.products || {};
              var entries = Object.entries(products);
              if (entries.length === 0) return processInv(idx + 1);

              var rows = entries.map(function(entry) {
                var pid = entry[0], p = entry[1];
                var stockVals = p.stock ? Object.values(p.stock) : [];
                var stockSum = stockVals.reduce(function(a, b) { return a + Number(b); }, 0);
                var priceVals = p.prices ? Object.values(p.prices) : [];
                return {
                  snapshot_id: snapshot.id, product_id: pid,
                  sku: p.sku || "", name: p.name || "", ean: p.ean || "",
                  stock: stockSum, price: Number(priceVals[0]) || 0,
                };
              });

              return sbPost("inventory_items", rows).then(function() {
                total += rows.length;
                if (entries.length < 1000) return processInv(idx + 1);
                return processPage(page + 1);
              });
            });
          }
          return processPage(1);
        }
        return processInv(0);
      });
    }).catch(function(err) {
      setFetchErr(err.message || "Nieznany blad");
      setFetching(false);
    });
  }

  function loadSnap(snap) {
    setSelSnap(snap);
    setLoading(true);
    sbGet("inventory_items", "snapshot_id=eq." + snap.id + "&order=name.asc&limit=5000").then(function(d) {
      setItems(d);
      setLoading(false);
    });
  }

  function loadCompare(snap) {
    setCmpSnap(snap);
    sbGet("inventory_items", "snapshot_id=eq." + snap.id + "&order=name.asc&limit=5000").then(setCmpItems);
  }

  function getMerged() {
    var filtered = items.filter(function(i) {
      if (!search) return true;
      var s = search.toLowerCase();
      return (i.name || "").toLowerCase().includes(s) || (i.sku || "").toLowerCase().includes(s);
    });
    if (cmpSnap && cmpItems.length > 0) {
      var cmpMap = {};
      cmpItems.forEach(function(i) { cmpMap[i.product_id] = i; });
      filtered = filtered.map(function(i) {
        var prev = cmpMap[i.product_id];
        return Object.assign({}, i, { prev_stock: prev ? prev.stock : null, diff: prev ? i.stock - prev.stock : null });
      });
    }
    filtered.sort(function(a, b) {
      var mul = sortDir === "asc" ? 1 : -1;
      if (sortBy === "stock" || sortBy === "price" || sortBy === "diff") return mul * ((a[sortBy] || 0) - (b[sortBy] || 0));
      return mul * (a[sortBy] || "").localeCompare(b[sortBy] || "", "pl");
    });
    return filtered;
  }

  function toggleSort(col) {
    if (sortBy === col) setSortDir(function(d) { return d === "asc" ? "desc" : "asc"; });
    else { setSortBy(col); setSortDir("asc"); }
  }

  var data = selSnap ? getMerged() : [];
  var totalStock = data.reduce(function(s, i) { return s + (i.stock || 0); }, 0);
  var totalValue = data.reduce(function(s, i) { return s + (i.stock || 0) * (i.price || 0); }, 0);
  var zeroStock = data.filter(function(i) { return i.stock === 0; }).length;
  var sortArrow = function(col) { return sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""; };

  var sqlCode = "-- Uruchom w Supabase SQL Editor:\n\nCREATE TABLE inventory_snapshots (\n  id BIGSERIAL PRIMARY KEY,\n  snapshot_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  fetched_by TEXT DEFAULT 'manual'\n);\n\nCREATE TABLE inventory_items (\n  id BIGSERIAL PRIMARY KEY,\n  snapshot_id BIGINT REFERENCES inventory_snapshots(id) ON DELETE CASCADE,\n  product_id TEXT NOT NULL,\n  sku TEXT,\n  name TEXT,\n  ean TEXT,\n  stock INTEGER NOT NULL DEFAULT 0,\n  price NUMERIC(12,2),\n  variant_id TEXT\n);\n\nCREATE INDEX idx_items_snapshot ON inventory_items(snapshot_id);\nCREATE INDEX idx_items_product ON inventory_items(product_id);\nCREATE INDEX idx_snapshots_date ON inventory_snapshots(snapshot_date);";

  var cronCode = "-- Supabase Dashboard: Database > Extensions > pg_cron (wlacz)\n-- Potem w SQL Editor:\n\nSELECT cron.schedule(\n  'monthly-inventory-snapshot',\n  '0 6 1 * *',\n  -- 1. dnia miesiaca o 6:00 UTC\n  'SELECT net.http_post(\n    url := your_edge_function_url,\n    headers := your_auth_headers\n  );'\n);";

  var edgeCode = "// supabase/functions/fetch-inventory/index.ts\n// Deploy: supabase functions deploy fetch-inventory\n// Sekrety: supabase secrets set BASELINKER_TOKEN=xxx\n\n// Edge Function pobiera stany z BaseLinker API\n// i zapisuje do Supabase — identycznie jak\n// przycisk 'Pobierz teraz' w dashboardzie.\n// Szczegoly: docs.supabase.com/guides/functions";

  var codeMap = { sql: sqlCode, edge: edgeCode, cron: cronCode };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a1a", color: "#ccd6f6", fontFamily: "monospace, -apple-system, sans-serif" }}>
      <style>{"* { box-sizing: border-box; } select option { background: #1a1a2e; color: #ccd6f6; }"}</style>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 20px" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: 2, background: "linear-gradient(135deg, #6366f1, #0ea5e9, #10b981)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              BL Inventory Tracker
            </h1>
            <p style={{ margin: "4px 0 0", color: "#8892b0", fontSize: 12 }}>Snapshoty stanow magazynowych → Supabase</p>
          </div>
          <button onClick={function() { setShowCfg(!showCfg); }} style={{
            padding: "7px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, color: "#8892b0", cursor: "pointer", fontFamily: "monospace", fontSize: 12 }}>
            {showCfg ? "Ukryj config" : "Pokaz config"}
          </button>
        </div>

        {/* Config */}
        {showCfg && (
          <div style={box}>
            <h2 style={headingSt}>⚙️ Konfiguracja</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelSt}>Supabase URL</label>
                <input style={inputSt} placeholder="https://xxx.supabase.co" value={cfg.url}
                  onChange={function(e) { setCfg(Object.assign({}, cfg, { url: e.target.value })); }} />
              </div>
              <div>
                <label style={labelSt}>Supabase Anon Key</label>
                <input style={inputSt} placeholder="eyJ..." value={cfg.key}
                  onChange={function(e) { setCfg(Object.assign({}, cfg, { key: e.target.value })); }} />
              </div>
              <div style={{ gridColumn: "1 / -1", position: "relative" }}>
                <label style={labelSt}>BaseLinker API Token</label>
                <input style={inputSt} type={showToken ? "text" : "password"} placeholder="Token z BaseLinker" value={cfg.token}
                  onChange={function(e) { setCfg(Object.assign({}, cfg, { token: e.target.value })); }} />
                <button onClick={function() { setShowToken(!showToken); }} style={{
                  position: "absolute", right: 10, bottom: 8, background: "none", border: "none",
                  color: "#8892b0", cursor: "pointer", fontSize: 14 }}>
                  {showToken ? "Hide" : "Show"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fetch */}
        <div style={box}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <h2 style={Object.assign({}, headingSt, { margin: 0 })}>📸 Snapshot stanow</h2>
            <button onClick={fetchNow} disabled={!canFetch || fetching} style={{
              padding: "11px 28px",
              background: fetching ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #10b981, #059669)",
              color: fetching ? "#8892b0" : "#fff", border: "none", borderRadius: 8,
              cursor: canFetch && !fetching ? "pointer" : "not-allowed",
              fontFamily: "monospace", fontSize: 14, fontWeight: 700 }}>
              {fetching ? "Pobieram..." : "Pobierz teraz"}
            </button>
          </div>
          {fetchMsg && (
            <div style={{
              padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8,
              border: "1px solid " + (fetchErr ? "rgba(239,68,68,0.3)" : !fetching ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)"),
              fontSize: 13, color: fetchErr ? "#f87171" : !fetching ? "#34d399" : "#8892b0" }}>
              {fetchMsg}
              {fetchErr && <div style={{ marginTop: 6, color: "#f87171" }}>Blad: {fetchErr}</div>}
            </div>
          )}
          {!canFetch && <div style={{ color: "#f59e0b", fontSize: 13, marginTop: 8 }}>Uzupelnij konfiguracje powyzej</div>}
        </div>

        {/* History */}
        <div style={box}>
          <h2 style={headingSt}>📊 Historia stanow</h2>
          {snapshots.length === 0 ? (
            <div style={{ color: "#8892b0", fontSize: 13, textAlign: "center", padding: 32 }}>
              Brak snapshotow. {canFetch ? "Kliknij Pobierz teraz." : "Podaj klucze konfiguracji."}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ minWidth: 220 }}>
                  <label style={labelSt}>Snapshot</label>
                  <select value={selSnap ? selSnap.id : ""} onChange={function(e) {
                    var s = snapshots.find(function(x) { return x.id === Number(e.target.value); });
                    if (s) loadSnap(s);
                  }} style={inputSt}>
                    <option value="">-- wybierz --</option>
                    {snapshots.map(function(s) {
                      return <option key={s.id} value={s.id}>{formatDate(s.snapshot_date)} ({s.fetched_by})</option>;
                    })}
                  </select>
                </div>
                <div style={{ minWidth: 220 }}>
                  <label style={labelSt}>Porownaj z</label>
                  <select value={cmpSnap ? cmpSnap.id : ""} onChange={function(e) {
                    if (!e.target.value) { setCmpSnap(null); setCmpItems([]); return; }
                    var s = snapshots.find(function(x) { return x.id === Number(e.target.value); });
                    if (s) loadCompare(s);
                  }} style={inputSt}>
                    <option value="">-- bez porownania --</option>
                    {snapshots.filter(function(s) { return !selSnap || s.id !== selSnap.id; }).map(function(s) {
                      return <option key={s.id} value={s.id}>{formatDate(s.snapshot_date)} ({s.fetched_by})</option>;
                    })}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <label style={labelSt}>Szukaj</label>
                  <input style={inputSt} placeholder="Nazwa lub SKU..." value={search}
                    onChange={function(e) { setSearch(e.target.value); }} />
                </div>
              </div>

              {selSnap && data.length > 0 && (
                <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  {[
                    { l: "Produktow", v: data.length, c: "#6366f1" },
                    { l: "Laczny stan", v: totalStock.toLocaleString("pl"), c: "#0ea5e9" },
                    { l: "Wartosc", v: totalValue.toLocaleString("pl", { minimumFractionDigits: 2 }) + " PLN", c: "#10b981" },
                    { l: "Stan = 0", v: zeroStock, c: zeroStock > 0 ? "#f59e0b" : "#6b7280" },
                  ].map(function(s) {
                    return (
                      <div key={s.l} style={{ flex: 1, minWidth: 130, padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 10, borderLeft: "3px solid " + s.c }}>
                        <div style={{ color: "#8892b0", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5 }}>{s.l}</div>
                        <div style={{ color: "#e0e0e0", fontSize: 18, fontWeight: 700, marginTop: 3 }}>{s.v}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {loading ? (
                <div style={{ color: "#8892b0", textAlign: "center", padding: 32 }}>Ladowanie...</div>
              ) : selSnap && data.length > 0 ? (
                <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                        {[
                          { k: "sku", l: "SKU", a: "left" },
                          { k: "name", l: "Nazwa", a: "left" },
                          { k: "ean", l: "EAN", a: "left" },
                          { k: "stock", l: "Stan", a: "right" },
                        ].concat(cmpSnap ? [
                          { k: "prev", l: "Poprz.", a: "right" },
                          { k: "diff", l: "Zmiana", a: "right" },
                        ] : []).concat([
                          { k: "price", l: "Cena", a: "right" },
                        ]).map(function(col) {
                          return (
                            <th key={col.k} onClick={function() { toggleSort(col.k); }} style={{
                              padding: "9px 12px", textAlign: col.a, color: "#8892b0", fontWeight: 600,
                              cursor: "pointer", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.06)",
                              fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2, userSelect: "none" }}>
                              {col.l}{sortArrow(col.k)}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {data.slice(0, 500).map(function(item, idx) {
                        var bg = idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)";
                        var sc = item.stock === 0 ? "#f87171" : item.stock < 5 ? "#f59e0b" : "#34d399";
                        var dc = (item.diff || 0) > 0 ? "#34d399" : (item.diff || 0) < 0 ? "#f87171" : "#8892b0";
                        return (
                          <tr key={item.id || idx} style={{ background: bg }}>
                            <td style={{ padding: "7px 12px", color: "#8892b0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>{item.sku}</td>
                            <td style={{ padding: "7px 12px", color: "#ccd6f6", borderBottom: "1px solid rgba(255,255,255,0.03)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</td>
                            <td style={{ padding: "7px 12px", color: "#8892b0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 11 }}>{item.ean}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.03)", color: sc }}>{item.stock}</td>
                            {cmpSnap && (
                              <>
                                <td style={{ padding: "7px 12px", textAlign: "right", color: "#8892b0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                                  {item.prev_stock != null ? item.prev_stock : "--"}
                                </td>
                                <td style={{ padding: "7px 12px", textAlign: "right", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.03)", color: dc }}>
                                  {item.diff != null ? (item.diff > 0 ? "+" + item.diff : String(item.diff)) : "--"}
                                </td>
                              </>
                            )}
                            <td style={{ padding: "7px 12px", textAlign: "right", color: "#ccd6f6", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                              {(item.price || 0).toLocaleString("pl", { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {data.length > 500 && (
                    <div style={{ padding: 10, textAlign: "center", color: "#8892b0", fontSize: 11 }}>
                      Pokazano 500 z {data.length}. Uzyj wyszukiwarki.
                    </div>
                  )}
                </div>
              ) : selSnap ? (
                <div style={{ color: "#8892b0", textAlign: "center", padding: 32 }}>Brak danych w tym snapshocie.</div>
              ) : null}
            </div>
          )}
        </div>

        {/* Setup */}
        <div style={box}>
          <h2 style={headingSt}>🛠️ Instrukcja wdrozenia</h2>
          <p style={{ color: "#8892b0", fontSize: 12, margin: "0 0 16px", lineHeight: 1.6 }}>
            Dashboard dziala od razu po podaniu kluczy. Ponizej SQL i cron setup.
          </p>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[{ id: "sql", l: "1. SQL Schema" }, { id: "edge", l: "2. Edge Function" }, { id: "cron", l: "3. Cron Setup" }].map(function(t) {
              return (
                <button key={t.id} onClick={function() { setTab(t.id); }} style={{
                  padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)",
                  background: tab === t.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                  color: tab === t.id ? "#a5b4fc" : "#8892b0",
                  cursor: "pointer", fontFamily: "monospace", fontSize: 11, fontWeight: 600 }}>
                  {t.l}
                </button>
              );
            })}
          </div>
          <pre style={{
            background: "rgba(0,0,0,0.3)", padding: 18, borderRadius: 10, overflow: "auto",
            maxHeight: 300, color: "#a5b4fc", fontSize: 11, lineHeight: 1.7,
            border: "1px solid rgba(255,255,255,0.04)", margin: 0, whiteSpace: "pre-wrap" }}>
            {codeMap[tab]}
          </pre>
        </div>

      </div>
    </div>
  );
}
