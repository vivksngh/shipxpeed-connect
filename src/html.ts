// Server-rendered HTML (zero-dependency templating via tagged strings).

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface LayoutOpts {
  clientName?: string;
  active?: string;
  wide?: boolean;
}

export function layout(title: string, body: string, opts: LayoutOpts = {}): string {
  const nav = opts.clientName
    ? `<nav class="topbar">
        <a class="brand" href="/dashboard">Shipxpeed <span>Connect</span></a>
        <div class="navlinks">
          <a href="/dashboard" class="${opts.active === "dashboard" ? "on" : ""}">Stores</a>
        </div>
        <div class="navuser">
          <span>${esc(opts.clientName)}</span>
          <form method="post" action="/logout"><button class="linkbtn">Logout</button></form>
        </div>
      </nav>`
    : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
${nav}
<main class="${opts.wide ? "wrap wide" : "wrap"}">${body}</main>
</body></html>`;
}

const CSS = `
:root{--bg:#0f1220;--panel:#171a2b;--panel2:#1f2338;--line:#2a2f4a;--txt:#e7e9f3;--mut:#9aa0bf;--brand:#5b6cff;--brand2:#7c8bff;--ok:#2ecc71;--warn:#f5a623;--err:#ff5a6a;--chip:#242a45}
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--txt)}
a{color:var(--brand2);text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:28px 20px}
.wrap.wide{max-width:1200px}
.topbar{display:flex;align-items:center;gap:18px;padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
.brand{font-weight:700;font-size:18px;color:var(--txt)}
.brand span{color:var(--brand2)}
.navlinks{display:flex;gap:14px;flex:1}
.navlinks a{color:var(--mut);padding:6px 10px;border-radius:8px}
.navlinks a.on,.navlinks a:hover{color:var(--txt);background:var(--panel2)}
.navuser{display:flex;align-items:center;gap:12px;color:var(--mut)}
.linkbtn{background:none;border:0;color:var(--mut);cursor:pointer;font-size:14px}
.linkbtn:hover{color:var(--err)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;margin:0 0 18px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}
.sub{color:var(--mut);margin:0 0 18px}
label{display:block;font-size:13px;color:var(--mut);margin:14px 0 6px}
input[type=text],input[type=email],input[type=password]{width:100%;padding:11px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--txt);font-size:15px}
input:focus{outline:none;border-color:var(--brand)}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--brand);color:#fff;border:0;padding:11px 18px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
.btn:hover{background:var(--brand2)}
.btn.sm{padding:7px 12px;font-size:13px}
.btn.ghost{background:var(--panel2);color:var(--txt);border:1px solid var(--line)}
.btn.ghost:hover{border-color:var(--brand)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.err{background:rgba(255,90,106,.12);border:1px solid var(--err);color:#ffd0d5;padding:10px 12px;border-radius:10px;margin:0 0 14px;font-size:14px}
.ok{background:rgba(46,204,113,.12);border:1px solid var(--ok);color:#c7f6da;padding:10px 12px;border-radius:10px;margin:0 0 14px;font-size:14px}
.center{max-width:400px;margin:6vh auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
tr:hover td{background:var(--panel2)}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;background:var(--chip);color:var(--mut);font-size:12px}
.chip.ok{background:rgba(46,204,113,.15);color:#7ee2a8}
.chip.warn{background:rgba(245,166,35,.15);color:#f3c37a}
.chip.err{background:rgba(255,90,106,.15);color:#ffabb3}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.spread{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.muted{color:var(--mut)}
.store{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid var(--line);border-radius:12px;margin:0 0 10px;background:var(--panel2)}
.bulkbar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;padding:12px 14px;background:var(--panel2);border:1px solid var(--line);border-radius:12px;margin:0 0 14px}
.filterbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.ftab{cursor:pointer;padding:8px 14px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);color:var(--mut);font-size:13.5px;font-family:inherit}
.ftab:hover{border-color:var(--brand)}
.ftab.active{background:var(--brand);border-color:var(--brand);color:#fff}
.ftab .fc{display:inline-block;margin-left:6px;padding:0 7px;border-radius:999px;background:rgba(0,0,0,.22);font-size:12px}
.ftab.active .fc{background:rgba(255,255,255,.22)}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 12px}
.tin{padding:9px 11px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--txt);font-size:13.5px;font-family:inherit}
.tin.sel{width:auto}
#q{flex:1;min-width:220px}
.dlbl{font-size:12px;color:var(--mut);display:inline-flex;align-items:center;gap:6px}
.dlbl .tin{padding:7px 9px}
.btn.xs{padding:5px 10px;font-size:12px}
.rowact{margin-bottom:4px}
details.od>summary{cursor:pointer;color:var(--brand2);font-size:13px}
details.od pre{background:#0c0e18;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;max-height:340px;font-size:12px;color:#c7cbe6}
.small{font-size:12px;color:var(--mut)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;font-size:13px}
select{width:100%;padding:11px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--txt);font-size:15px}
input[type=number]{width:100%;padding:11px 12px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--txt);font-size:15px}
dialog.modal{border:1px solid var(--line);background:var(--panel);color:var(--txt);border-radius:14px;padding:22px;max-width:520px;width:92%}
dialog.modal::backdrop{background:rgba(4,6,14,.6)}
.row4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px}
@media(max-width:560px){.row4{grid-template-columns:1fr 1fr}}
`;

// ---------------- pages ----------------

export function loginPage(error?: string, notice?: string): string {
  return layout(
    "Login — Shipxpeed Connect",
    `<div class="center">
      <div class="card">
        <h1>Shipxpeed <span style="color:var(--brand2)">Connect</span></h1>
        <p class="sub">Sign in to manage your Shopify orders.</p>
        ${error ? `<div class="err">${esc(error)}</div>` : ""}
        ${notice ? `<div class="ok">${esc(notice)}</div>` : ""}
        <form method="post" action="/login">
          <label>Email</label>
          <input type="email" name="email" required autofocus>
          <label>Password</label>
          <input type="password" name="password" required>
          <div style="height:18px"></div>
          <button class="btn" type="submit" style="width:100%">Sign in</button>
        </form>
      </div>
    </div>`
  );
}

export function setupPage(key: string, error?: string): string {
  return layout(
    "Setup — Shipxpeed Connect",
    `<div class="center"><div class="card">
      <h1>Create a client login</h1>
      <p class="sub">One-time setup — keep this URL private (it needs your setup key).</p>
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <form method="post" action="/setup">
        <input type="hidden" name="key" value="${esc(key)}">
        <label>Client name</label>
        <input type="text" name="name" placeholder="Pusti Feni">
        <label>Email</label>
        <input type="email" name="email" required>
        <label>Password (min 6 chars)</label>
        <input type="password" name="password" required minlength="6">
        <div style="height:16px"></div>
        <button class="btn" type="submit" style="width:100%">Create login</button>
      </form>
    </div></div>`
  );
}

export function dashboardPage(clientName: string, stores: any[]): string {
  const list = stores.length
    ? stores
        .map((s) => {
          const connected = s.status === "connected" && s.access_token;
          return `<div class="store">
            <div>
              <div style="font-weight:600">${esc(s.shop_domain)}</div>
              <div class="small">${connected ? `Connected${s.installed_at ? " · " + esc(s.installed_at) : ""}` : "Not connected"}</div>
            </div>
            <div class="row">
              <span class="chip ${connected ? "ok" : "warn"}">${connected ? "Connected" : "Pending"}</span>
              ${connected ? `<a class="btn sm" href="/store/${s.id}/orders">View orders</a>` : `<a class="btn sm" href="/store/${s.id}/reconnect">Connect</a>`}
              <form method="post" action="/store/${s.id}/delete" onsubmit="return confirm('Remove this store?')"><button class="btn sm ghost">Remove</button></form>
            </div>
          </div>`;
        })
        .join("")
    : `<p class="muted">No stores connected yet.</p>`;

  return layout(
    "Stores — Shipxpeed Connect",
    `<div class="spread"><h1>Your stores</h1><a class="btn" href="/connect">+ Connect a store</a></div>
     <p class="sub">Connect a Shopify store, then fetch and process its orders.</p>
     <div class="card">${list}</div>`,
    { clientName, active: "dashboard" }
  );
}

export function connectPage(clientName: string, error?: string, notice?: string, appUrl?: string): string {
  const callback = `${(appUrl ?? "").replace(/\/$/, "")}/auth/shopify/callback`;
  return layout(
    "Connect store — Shipxpeed Connect",
    `<h1>Connect a Shopify store</h1>
     <p class="sub">Enter the store's own app credentials (Client ID + Secret). You'll be sent to Shopify to approve, then brought back — no app review needed.</p>
     ${error ? `<div class="err">${esc(error)}</div>` : ""}
     ${notice ? `<div class="ok">${esc(notice)}</div>` : ""}
     <div class="card" style="max-width:560px">
       <form method="post" action="/connect/oauth-app">
         <label>Store domain</label>
         <input type="text" name="shop" placeholder="your-store.myshopify.com" required autofocus>
         <div class="small" style="margin-top:4px">Example: pusti-feni-2.myshopify.com</div>
         <label style="margin-top:14px">Client ID (API key)</label>
         <input type="text" name="api_key" placeholder="e.g. 7211243..." required>
         <label style="margin-top:14px">Client secret (API secret key)</label>
         <input type="text" name="api_secret" placeholder="e.g. shpss_... or 32-char secret" required>
         <div style="height:16px"></div>
         <button class="btn" type="submit">Connect &amp; authorize on Shopify →</button>
       </form>
     </div>

     <div class="card" style="max-width:560px;margin-top:16px">
       <h3 style="margin-top:0">How to set up the store's app (one-time per store)</h3>
       <p class="small" style="margin-top:0">Done in the store's own Shopify admin → <b>Settings → Apps and sales channels → Develop apps / Build apps in Dev Dashboard</b>.</p>
       <ol style="margin:0;padding-left:20px">
         <li>Create an app (name it e.g. <b>Shipzap</b>).</li>
         <li>Set the <b>Allowed redirection URL</b> (and App URL) to:
           <div class="small" style="margin-top:4px"><code>${esc(callback)}</code></div>
         </li>
         <li>Enable these Admin API scopes:
           <div class="small" style="margin-top:4px"><code>read_orders</code>, <code>write_orders</code>, <code>read_fulfillments</code>, <code>write_fulfillments</code>, <code>read_merchant_managed_fulfillment_orders</code>, <code>write_merchant_managed_fulfillment_orders</code>, <code>read_products</code>, <code>read_customers</code>, <code>read_assigned_fulfillment_orders</code>, <code>write_assigned_fulfillment_orders</code></div>
         </li>
         <li>Under <b>Distribution</b>, choose <b>Custom distribution</b> and point it at that store (their own store — no review needed).</li>
         <li>Copy the app's <b>Client ID</b> and <b>Client secret</b> and paste them above, then Connect.</li>
       </ol>
     </div>

     <details class="od" style="max-width:560px;margin-top:14px">
       <summary>Alternative: connect with an Admin API token (older stores only)</summary>
       <div class="card" style="margin-top:10px">
         <form method="post" action="/connect/token">
           <label>Store domain</label>
           <input type="text" name="shop" placeholder="your-store.myshopify.com" required>
           <label style="margin-top:12px">Admin API access token</label>
           <input type="text" name="token" placeholder="shpat_..." required>
           <div class="small" style="margin-top:4px">From an older store's <b>Develop apps → Install → API credentials → Admin API access token</b>.</div>
           <div style="height:12px"></div>
           <button class="btn ghost sm" type="submit">Connect with token</button>
         </form>
       </div>
     </details>`,
    { clientName, active: "dashboard" }
  );
}

function money(o: any): string {
  const amt = o?.total_price ?? o?.current_total_price ?? "";
  const cur = o?.currency ?? "";
  return amt ? `${esc(cur)} ${esc(amt)}` : "";
}
function fdate(s: string | null | undefined): string {
  if (!s) return "";
  return esc(String(s).replace("T", " ").slice(0, 16));
}
function fulChip(o: any): string {
  const f = o?.fulfillment_status;
  if (f === "fulfilled") return `<span class="chip ok">fulfilled</span>`;
  if (f === "partial") return `<span class="chip warn">partial</span>`;
  return `<span class="chip warn">unfulfilled</span>`;
}

function payMode(o: any): string {
  const gw = (o?.payment_gateway_names ?? []).join(" ").toLowerCase();
  if (gw.includes("cod") || gw.includes("cash on delivery")) return "COD";
  if (!gw && o?.financial_status === "pending") return "COD";
  return "Prepaid";
}

export function ordersPage(
  clientName: string,
  store: any,
  orders: any[],
  procMap: Record<string, any>,
  notice?: string
): string {
  const counts = { new: 0, fulfilled: 0, junk: 0 };
  const rows = orders
    .map((o) => {
      const proc = procMap[String(o.id)];
      const cust = o.customer ? `${o.customer.first_name ?? ""} ${o.customer.last_name ?? ""}`.trim() : (o.email ?? "");
      const ship = o.shipping_address;
      const place = ship ? `${ship.city ?? ""}${ship.province_code ? ", " + ship.province_code : ""}` : "";
      const items = (o.line_items ?? []).reduce((n: number, li: any) => n + (li.quantity ?? 0), 0);
      const st = proc?.status;
      const awb = proc?.awb ? String(proc.awb) : "";
      const cancelled = !!o.cancelled_at;
      const isJunk = proc?.junk == 1;
      const isFulfilled = o.fulfillment_status === "fulfilled" || st === "fulfilled";
      // bucket: cancelled-on-Shopify or manually-junked -> junk; fulfilled -> fulfilled; everything else -> new
      const bucket = cancelled || isJunk ? "junk" : isFulfilled ? "fulfilled" : "new";
      counts[bucket]++;

      const pay = payMode(o);
      const phoneDigits = String(o.phone ?? ship?.phone ?? o.billing_address?.phone ?? "").replace(/\D/g, "");
      const dateKey = (o.created_at ?? "").slice(0, 10); // YYYY-MM-DD
      const searchBlob = `${o.name ?? ""} ${awb} ${phoneDigits} ${cust}`.toLowerCase();

      // status chip
      let procChip: string;
      if (cancelled) procChip = `<span class="chip err">cancelled</span>`;
      else if (isJunk) procChip = `<span class="chip err">junk</span>`;
      else if (isFulfilled) procChip = `<span class="chip ok">fulfilled${awb ? " · " + esc(awb) : ""}</span>`;
      else if (st === "exported") procChip = `<span class="chip warn">exported${awb ? " · " + esc(awb) : ""}</span>`;
      else if (st === "shipped") procChip = `<span class="chip warn">awaiting AWB</span>`;
      else procChip = `<span class="chip">new</span>`;

      // junk / restore control (restore only for manually-junked; Shopify-cancelled can't be un-cancelled here)
      let junkCtl = "";
      if (isJunk && !cancelled) {
        junkCtl = `<form method="post" action="/store/${store.id}/junk" style="display:inline">
            <input type="hidden" name="order_id" value="${esc(o.id)}">
            <input type="hidden" name="op" value="unjunk">
            <button class="btn ghost xs" type="submit">↩ Restore</button></form>`;
      } else if (!cancelled) {
        junkCtl = `<form method="post" action="/store/${store.id}/junk" style="display:inline">
            <input type="hidden" name="order_id" value="${esc(o.id)}">
            <input type="hidden" name="op" value="junk">
            <button class="btn ghost xs" type="submit">🗑 Junk</button></form>`;
      }

      return `<tr data-bucket="${bucket}" data-pay="${pay}" data-date="${esc(dateKey)}" data-search="${esc(searchBlob)}">
        <td><input type="checkbox" class="rowchk" name="order_ids" value="${esc(o.id)}" form="bulkform"></td>
        <td><b>${esc(o.name)}</b><div class="small">${fdate(o.created_at)}</div></td>
        <td>${esc(cust)}<div class="small">${esc(place)}</div></td>
        <td>${items}</td>
        <td>${money(o)}<div class="small">${esc(o.financial_status ?? "")}</div></td>
        <td><span class="chip ${pay === "COD" ? "warn" : "ok"}">${pay}</span></td>
        <td>${fulChip(o)}</td>
        <td>${procChip}</td>
        <td>
          <div class="rowact">${junkCtl}</div>
          <details class="od"><summary>Details</summary>
            <div class="grid2" style="margin:8px 0">
              <div>Order ID</div><div>${esc(o.id)}</div>
              <div>Email</div><div>${esc(o.email ?? "")}</div>
              <div>Phone</div><div>${esc(o.phone ?? ship?.phone ?? "")}</div>
              <div>AWB</div><div>${esc(awb)}</div>
              <div>Payment</div><div>${esc((o.payment_gateway_names ?? []).join(", "))} (${pay})</div>
            </div>
            <pre>${esc(JSON.stringify(o, null, 2))}</pre>
          </details>
        </td>
      </tr>`;
    })
    .join("");

  return layout(
    `Orders — ${esc(store.shop_domain)}`,
    `<div class="spread">
       <div><h1>Orders</h1><p class="sub">${esc(store.shop_domain)} · ${orders.length} orders fetched</p></div>
       <div class="row">
         <a class="btn ghost sm" href="/store/${store.id}/orders">↻ Refresh</a>
         <a class="btn ghost sm" href="/store/${store.id}/import">⬆ Import AWB sheet</a>
       </div>
     </div>
     ${notice ? `<div class="ok">${esc(notice)}</div>` : ""}
     <div class="filterbar">
       <button type="button" class="ftab active" data-filter="new">New <span class="fc">${counts.new}</span></button>
       <button type="button" class="ftab" data-filter="fulfilled">Fulfilled <span class="fc">${counts.fulfilled}</span></button>
       <button type="button" class="ftab" data-filter="junk">Cancelled / Junk <span class="fc">${counts.junk}</span></button>
       <button type="button" class="ftab" data-filter="all">All <span class="fc">${orders.length}</span></button>
     </div>
     <div class="toolbar">
       <input type="search" id="q" class="tin" placeholder="Search order #, AWB, or mobile…">
       <select id="payf" class="tin sel"><option value="">Payment: All</option><option value="COD">COD only</option><option value="Prepaid">Prepaid only</option></select>
       <label class="dlbl">From <input type="date" id="dfrom" class="tin"></label>
       <label class="dlbl">To <input type="date" id="dto" class="tin"></label>
       <button type="button" class="btn ghost xs" id="clearf">Clear</button>
     </div>
     <form id="bulkform" method="post" action="/store/${store.id}/process">
       <div class="bulkbar">
         <label style="margin:0"><input type="checkbox" id="selall"> Select all <span id="selallhint" class="muted"></span></label>
         <span class="muted" id="selcount">0 selected</span>
         <div style="flex:1"></div>
         <button class="btn sm" type="button" id="openproc">Process → Export (Shipxpeed format)</button>
       </div>
       <dialog id="procmodal" class="modal">
         <h2 style="margin-bottom:4px">Shipment details for this batch</h2>
         <p class="small">Applied to the first row of every selected order.</p>
         <label>Warehouse Name *</label>
         <input type="text" name="warehouse" placeholder="Main Warehouse" required>
         <label>Service Type *</label>
         <select name="service_type" required><option>Surface</option><option>Air</option></select>
         <div class="row4" style="margin-top:6px">
           <div><label>Weight (kg) *</label><input type="number" step="0.01" min="0" name="weight" placeholder="0.5" required></div>
           <div><label>Length *</label><input type="number" step="0.1" min="0" name="length" placeholder="20" required></div>
           <div><label>Width *</label><input type="number" step="0.1" min="0" name="width" placeholder="15" required></div>
           <div><label>Height *</label><input type="number" step="0.1" min="0" name="height" placeholder="5" required></div>
         </div>
         <div class="row" style="justify-content:flex-end;margin-top:18px">
           <button type="button" class="btn ghost sm" id="cancelproc">Cancel</button>
           <button type="submit" class="btn sm">Generate export ↓</button>
         </div>
       </dialog>
     </form>
     <div class="card" style="padding:6px 6px">
       <table>
         <thead><tr><th></th><th>Order</th><th>Customer</th><th>Qty</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Status</th><th></th></tr></thead>
         <tbody>${rows || `<tr><td colspan="9" class="muted" style="padding:20px">No orders found.</td></tr>`}</tbody>
       </table>
       <div id="noresults" class="muted" style="display:none;padding:18px">No orders match these filters.</div>
     </div>
     <script>
       const allRows=()=>[...document.querySelectorAll('tr[data-bucket]')];
       const chks=()=>[...document.querySelectorAll('.rowchk')];
       const visRows=()=>allRows().filter(r=>r.style.display!=='none');
       const visChks=()=>visRows().map(r=>r.querySelector('.rowchk')).filter(Boolean);
       const selected=()=>chks().filter(c=>c.checked).length;
       const selall=document.getElementById('selall');
       const qEl=document.getElementById('q');
       const payEl=document.getElementById('payf');
       const fromEl=document.getElementById('dfrom');
       const toEl=document.getElementById('dto');
       let filter='new';
       const upd=()=>{
         document.getElementById('selcount').textContent=selected()+' selected';
         const v=visChks();
         selall.checked=v.length>0 && v.every(c=>c.checked);
       };
       function applyFilters(){
         document.querySelectorAll('.ftab').forEach(t=>t.classList.toggle('active',t.dataset.filter===filter));
         const q=(qEl.value||'').trim().toLowerCase();
         const pay=payEl.value;
         const from=fromEl.value, to=toEl.value;
         let shown=0;
         allRows().forEach(r=>{
           let ok=(filter==='all')||r.dataset.bucket===filter;
           if(ok && q) ok=(r.dataset.search||'').indexOf(q)!==-1;
           if(ok && pay) ok=r.dataset.pay===pay;
           if(ok && from) ok=(r.dataset.date||'')>=from;
           if(ok && to) ok=(r.dataset.date||'')<=to;
           r.style.display=ok?'':'none';
           if(ok) shown++; else {const c=r.querySelector('.rowchk'); if(c)c.checked=false;}
         });
         document.getElementById('noresults').style.display=shown?'none':'';
         document.getElementById('selallhint').textContent='(only shown)';
         upd();
       }
       document.querySelectorAll('.ftab').forEach(t=>t.addEventListener('click',()=>{filter=t.dataset.filter;applyFilters();}));
       qEl.addEventListener('input',applyFilters);
       payEl.addEventListener('change',applyFilters);
       fromEl.addEventListener('change',applyFilters);
       toEl.addEventListener('change',applyFilters);
       document.getElementById('clearf').addEventListener('click',()=>{qEl.value='';payEl.value='';fromEl.value='';toEl.value='';applyFilters();});
       selall.addEventListener('change',e=>{visChks().forEach(c=>c.checked=e.target.checked);upd();});
       chks().forEach(c=>c.addEventListener('change',upd));
       applyFilters();
       const modal=document.getElementById('procmodal');
       document.getElementById('openproc').addEventListener('click',()=>{ if(selected()===0){alert('Select at least one order first.');return;} modal.showModal(); });
       document.getElementById('cancelproc').addEventListener('click',()=>modal.close());
     </script>`,
    { clientName, active: "dashboard", wide: true }
  );
}

export function importPage(clientName: string, store: any, error?: string, notice?: string): string {
  return layout(
    `Import — ${esc(store.shop_domain)}`,
    `<h1>Import updates sheet (AWB &amp; status)</h1>
     <p class="sub">Upload the Shipxpeed updates sheet. Each order is matched by its number, the AWB + courier are written to Shopify as tracking, the order is <b>marked fulfilled</b>, and the shipment status is stored.</p>
     ${error ? `<div class="err">${esc(error)}</div>` : ""}
     ${notice ? `<div class="ok">${esc(notice)}</div>` : ""}
     <div class="card" style="max-width:560px">
       <form method="post" action="/store/${store.id}/import" enctype="multipart/form-data">
         <label>CSV file</label>
         <input type="file" name="file" accept=".csv" required>
         <div class="small" style="margin-top:6px">Columns: <b>Shopify Order Number, AWB, Shipment Status, Courier Name</b>. If your file is .xlsx, use Excel → Save As → CSV first.</div>
         <div style="height:16px"></div>
         <button class="btn" type="submit">Upload &amp; write back to Shopify</button>
       </form>
     </div>
     <p style="margin-top:14px"><a href="/store/${store.id}/orders">← Back to orders</a></p>`,
    { clientName, active: "dashboard", wide: false }
  );
}
