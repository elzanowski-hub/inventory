// scripts/fetch-snapshot.js
// Pobiera stany magazynowe z BaseLinker i zapisuje snapshot do Supabase

var SUPABASE_URL = process.env.SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_KEY;
var BASELINKER_TOKEN = process.env.BASELINKER_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY || !BASELINKER_TOKEN) {
  console.error("Brak zmiennych: SUPABASE_URL, SUPABASE_KEY, BASELINKER_TOKEN");
  process.exit(1);
}

async function sbPost(table, rows) {
  var res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    var text = await res.text();
    throw new Error("Supabase " + table + ": " + res.status + " " + text);
  }
  return res.json();
}

async function blCall(method, params) {
  var res = await fetch("https://api.baselinker.com/connector.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: BASELINKER_TOKEN,
      method: method,
      parameters: JSON.stringify(params || {}),
    }),
  });
  return res.json();
}

async function run() {
  console.log("Pobieram liste magazynow...");
  var invData = await blCall("getInventories");
  if (invData.status === "ERROR") throw new Error(invData.error_message);
  var inventories = invData.inventories || [];
  console.log("Znaleziono " + inventories.length + " magazyn(ow).");

  console.log("Tworze snapshot...");
  var snapArr = await sbPost("inventory_snapshots", [{ fetched_by: "cron" }]);
  var snapshot = snapArr[0];
  console.log("Snapshot ID: " + snapshot.id);

  var total = 0;

  for (var i = 0; i < inventories.length; i++) {
    var inv = inventories[i];
    var invName = inv.name || String(inv.inventory_id);
    var page = 1;
    var hasMore = true;

    while (hasMore) {
      console.log("  Magazyn: " + invName + " — strona " + page);
      var pd = await blCall("getInventoryProductsList", {
        inventory_id: inv.inventory_id,
        page: page,
      });
      if (pd.status === "ERROR") throw new Error(pd.error_message);

      var products = pd.products || {};
      var entries = Object.entries(products);
      if (entries.length === 0) {
        hasMore = false;
        break;
      }

      var rows = entries.map(function (entry) {
        var pid = entry[0], p = entry[1];
        var stockVals = p.stock ? Object.values(p.stock) : [];
        var stockSum = stockVals.reduce(function (a, b) { return a + Number(b); }, 0);
        var priceVals = p.prices ? Object.values(p.prices) : [];
        return {
          snapshot_id: snapshot.id,
          product_id: pid,
          sku: p.sku || "",
          name: p.name || "",
          ean: p.ean || "",
          stock: stockSum,
          price: Number(priceVals[0]) || 0,
          warehouse: invName,
        };
      });

      await sbPost("inventory_items", rows);
      total += rows.length;
      page++;
      if (entries.length < 1000) hasMore = false;
    }
  }

  console.log("Gotowe! Zapisano " + total + " produktow w snapshocie #" + snapshot.id);
}

run().catch(function (err) {
  console.error("BLAD:", err.message);
  process.exit(1);
});
