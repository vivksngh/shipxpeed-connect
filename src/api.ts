// Client-facing intake API + panel management for API-sourced orders.
// Orders received here are STORED in D1 (unlike Shopify orders, which are read live),
// then flow through the same export -> Shipxpeed -> write-back path.

import type { Env } from "./shopify";
import { layout } from "./html";
import { buildShipxpeedRows, SHIPXPEED_HEADER, type ManualInput } from "./export";

interface Client { id: number; email: string; name: string | null; is_admin: number; }

// ---------- small helpers ----------
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function genApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `sk_live_${b64}`;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------- API-key auth (Bearer) ----------
export async function authApiKey(req: Request, env: Env): Promise<{ client_id: number; api_key_id: number } | null> {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const hash = await sha256Hex(m[1].trim());
  const row = await env.DB.prepare(
    `SELECT id, client_id FROM api_keys WHERE key_hash = ? AND revoked = 0`
  ).bind(hash).first<{ id: number; client_id: number }>();
  if (!row) return null;
  // best-effort last-used stamp
  try { await env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).bind(row.id).run(); } catch {}
  return { client_id: row.client_id, api_key_id: row.id };
}

// ---------- normalize + validate an incoming order ----------
// ---------- pickup / warehouse ----------
// Validate the pickup address (the fields Shipxpeed needs to create a warehouse).
function normalizePickup(raw: any): { ok: true; value: any } | { ok: false; errors: string[] } {
  const e: string[] = [];
  const p = raw ?? {};
  const name = String(p.name ?? "").trim();
  const contact = String(p.contact ?? p.contact_name ?? "").trim();
  const phone = String(p.phone ?? "").replace(/\D/g, "");
  const email = String(p.email ?? "").trim();
  const address = String(p.address ?? p.line1 ?? "").trim();
  const pincode = String(p.pincode ?? "").trim();
  const city = String(p.city ?? "").trim();
  const state = String(p.state ?? "").trim();
  if (!name) e.push("pickup.name is required");
  if (!contact) e.push("pickup.contact is required");
  if (phone.length < 10) e.push("pickup.phone must be a valid phone number");
  if (!email) e.push("pickup.email is required");
  if (!address) e.push("pickup.address is required");
  if (!pincode) e.push("pickup.pincode is required");
  if (!city) e.push("pickup.city is required");
  if (!state) e.push("pickup.state is required");
  if (e.length) return { ok: false, errors: e };
  return { ok: true, value: { name, contact, phone, email, address, pincode, city, state } };
}

// A stable fingerprint over every warehouse field — any change means a new warehouse.
function whFingerprintInput(p: any): string {
  const n = (s: string) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return [n(p.name), n(p.contact), n(p.phone), n(p.email), n(p.address), n(p.pincode), n(p.city), n(p.state)].join("|");
}

// Find or create the warehouse for a pickup. New unique pickups get a fresh row
// (status 'pending') with a name unique within the client, ready to create in Shipxpeed.
async function resolveWarehouse(env: Env, clientId: number, p: any): Promise<{ id: number; name: string; status: string }> {
  const fp = await sha256Hex(whFingerprintInput(p));
  const existing = await env.DB.prepare(
    `SELECT id, name, shipxpeed_status FROM warehouses WHERE client_id = ? AND fingerprint = ?`
  ).bind(clientId, fp).first<any>();
  if (existing) return { id: existing.id, name: existing.name, status: existing.shipxpeed_status };

  const base = p.name || (p.city ? `${p.city} Pickup` : "Warehouse");
  let name = base, i = 1;
  while (await env.DB.prepare(`SELECT id FROM warehouses WHERE client_id = ? AND name = ?`).bind(clientId, name).first()) {
    i++; name = `${base} ${i}`;
  }
  try {
    const res = await env.DB.prepare(
      `INSERT INTO warehouses (client_id, name, contact_name, phone, email, address, pincode, city, state, fingerprint, shipxpeed_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
    ).bind(clientId, name, p.contact, p.phone, p.email, p.address, p.pincode, p.city, p.state, fp).run();
    const id = (res as any)?.meta?.last_row_id;
    if (id) return { id: Number(id), name, status: "pending" };
  } catch { /* unique clash from a concurrent insert — fall through to re-select */ }
  const row = await env.DB.prepare(`SELECT id, name, shipxpeed_status FROM warehouses WHERE client_id = ? AND fingerprint = ?`).bind(clientId, fp).first<any>();
  return { id: row.id, name: row.name, status: row.shipxpeed_status };
}

const REQUIRED_MSG = "Missing or invalid fields";

function normalizeOrder(raw: any): { ok: true; value: any } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const extId = String(raw?.external_order_id ?? "").trim();
  if (!extId) errors.push("external_order_id is required");

  const cust = raw?.customer ?? {};
  const addr = raw?.address ?? {};
  const name = String(cust.name ?? "").trim();
  const phone = String(cust.phone ?? "").replace(/\D/g, "");
  if (!name) errors.push("customer.name is required");
  if (phone.length < 10) errors.push("customer.phone must be a valid phone number");

  const line1 = String(addr.line1 ?? "").trim();
  const city = String(addr.city ?? "").trim();
  const state = String(addr.state ?? "").trim();
  const pincode = String(addr.pincode ?? "").trim();
  if (!line1) errors.push("address.line1 is required");
  if (!city) errors.push("address.city is required");
  if (!state) errors.push("address.state is required");
  if (!pincode) errors.push("address.pincode is required");

  let pay = String(raw?.payment_mode ?? "").trim().toLowerCase();
  pay = pay === "cod" || pay === "cash on delivery" ? "COD" : pay === "prepaid" || pay === "ppd" ? "Prepaid" : "";
  if (!pay) errors.push("payment_mode must be 'COD' or 'Prepaid'");

  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (!items.length) errors.push("items must be a non-empty array");

  const pk = normalizePickup(raw?.pickup);
  if (!pk.ok) errors.push(...pk.errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      pickup: (pk as { ok: true; value: any }).value,
      external_order_id: extId,
      order_number: String(raw.order_number ?? extId).trim(),
      payment_mode: pay,
      amount: Number(raw.amount ?? 0) || 0,
      currency: String(raw.currency ?? "INR").trim() || "INR",
      customer: { name, phone: phone.slice(-10), email: String(cust.email ?? "").trim() },
      address: {
        line1, line2: String(addr.line2 ?? "").trim(), city, state, pincode,
        country: String(addr.country ?? "IN").trim() || "IN",
      },
      items: items.map((it: any) => ({
        sku: String(it.sku ?? "").trim(),
        name: String(it.name ?? it.title ?? "Item").trim(),
        qty: Math.max(1, parseInt(it.qty ?? it.quantity ?? 1, 10) || 1),
        price: Number(it.price ?? 0) || 0,
      })),
      weight_kg: Number(raw.weight_kg ?? 0) || null,
      length_cm: Number(raw.length_cm ?? 0) || null,
      width_cm: Number(raw.width_cm ?? 0) || null,
      height_cm: Number(raw.height_cm ?? 0) || null,
      callback_url: String(raw.callback_url ?? "").trim() || null,
    },
  };
}

async function upsertOrder(env: Env, clientId: number, keyId: number, o: any, wh: { id: number; name: string }): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO api_orders
       (client_id, api_key_id, external_order_id, order_number, payment_mode, amount, currency,
        customer_json, address_json, items_json, weight_kg, length_cm, width_cm, height_cm,
        callback_url, warehouse_id, warehouse_name, status, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', datetime('now'), datetime('now'))
     ON CONFLICT(client_id, external_order_id) DO UPDATE SET
        order_number=excluded.order_number, payment_mode=excluded.payment_mode, amount=excluded.amount,
        currency=excluded.currency, customer_json=excluded.customer_json, address_json=excluded.address_json,
        items_json=excluded.items_json, weight_kg=excluded.weight_kg, length_cm=excluded.length_cm,
        width_cm=excluded.width_cm, height_cm=excluded.height_cm, callback_url=excluded.callback_url,
        warehouse_id=excluded.warehouse_id, warehouse_name=excluded.warehouse_name,
        updated_at=datetime('now')`
  ).bind(
    clientId, keyId, o.external_order_id, o.order_number, o.payment_mode, o.amount, o.currency,
    JSON.stringify(o.customer), JSON.stringify(o.address), JSON.stringify(o.items),
    o.weight_kg, o.length_cm, o.width_cm, o.height_cm, o.callback_url, wh.id, wh.name
  ).run();
  return o.external_order_id;
}

// ---------- POST /api/v1/orders ----------
export async function handleApiCreateOrders(req: Request, env: Env): Promise<Response> {
  const auth = await authApiKey(req, env);
  if (!auth) return json({ error: "unauthorized", message: "Provide a valid API key as 'Authorization: Bearer <key>'." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request", message: "Body must be valid JSON." }, 400); }

  const list = Array.isArray(body) ? body : Array.isArray(body?.orders) ? body.orders : [body];
  if (!list.length) return json({ error: "bad_request", message: "No orders in request." }, 400);
  if (list.length > 500) return json({ error: "too_many", message: "Max 500 orders per request." }, 400);

  const results: any[] = [];
  let accepted = 0;
  for (const raw of list) {
    const n = normalizeOrder(raw);
    if (!n.ok) { results.push({ external_order_id: raw?.external_order_id ?? null, status: "rejected", errors: n.errors }); continue; }
    try {
      const wh = await resolveWarehouse(env, auth.client_id, n.value.pickup);
      await upsertOrder(env, auth.client_id, auth.api_key_id, n.value, wh);
      accepted++;
      results.push({ external_order_id: n.value.external_order_id, status: "received", warehouse: wh.name, warehouse_new: wh.status === "pending" });
    } catch (e: any) {
      results.push({ external_order_id: n.value.external_order_id, status: "error", message: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return json({ accepted, rejected: list.length - accepted, results }, accepted ? 200 : 400);
}

function orderView(row: any): any {
  return {
    external_order_id: row.external_order_id,
    order_number: row.order_number,
    payment_mode: row.payment_mode,
    amount: row.amount,
    currency: row.currency,
    status: row.status,             // received | exported | placed | shipped | delivered | cancelled | error
    warehouse: row.warehouse_name ?? null,
    awb: row.awb ?? null,
    courier: row.courier ?? null,
    shipment_status: row.shipment_status ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------- GET /api/v1/orders/:external_id ----------
export async function handleApiGetOrder(req: Request, env: Env, extId: string): Promise<Response> {
  const auth = await authApiKey(req, env);
  if (!auth) return json({ error: "unauthorized" }, 401);
  const row = await env.DB.prepare(
    `SELECT * FROM api_orders WHERE client_id = ? AND external_order_id = ?`
  ).bind(auth.client_id, extId).first<any>();
  if (!row) return json({ error: "not_found", message: `No order with external_order_id '${extId}'.` }, 404);
  return json(orderView(row));
}

// ---------- GET /api/v1/orders?status=&updated_since=&limit= ----------
export async function handleApiListOrders(req: Request, env: Env, url: URL): Promise<Response> {
  const auth = await authApiKey(req, env);
  if (!auth) return json({ error: "unauthorized" }, 401);
  const status = url.searchParams.get("status");
  const since = url.searchParams.get("updated_since");
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  let q = `SELECT * FROM api_orders WHERE client_id = ?`;
  const binds: any[] = [auth.client_id];
  if (status) { q += ` AND status = ?`; binds.push(status); }
  if (since) { q += ` AND updated_at > ?`; binds.push(since); }
  q += ` ORDER BY updated_at DESC LIMIT ?`; binds.push(limit);
  const rows = (await env.DB.prepare(q).bind(...binds).all()).results ?? [];
  return json({ count: rows.length, orders: (rows as any[]).map(orderView) });
}

// ================= Panel (cookie-auth) pages =================

export async function apiKeysPage(env: Env, client: Client, justCreated?: string): Promise<string> {
  const keys = (await env.DB.prepare(
    `SELECT id, label, key_prefix, revoked, created_at, last_used_at FROM api_keys WHERE client_id = ? ORDER BY id DESC`
  ).bind(client.id).all()).results ?? [];

  const banner = justCreated
    ? `<div class="card" style="border-color:var(--ok);background:#12241b">
         <b>New API key — copy it now, it won't be shown again:</b>
         <div style="margin-top:8px"><code style="font-size:14px;word-break:break-all">${esc(justCreated)}</code></div>
       </div>`
    : "";

  const rows = (keys as any[]).map((k) => `
    <tr>
      <td>${esc(k.label || "—")}</td>
      <td><code>${esc(k.key_prefix)}…</code></td>
      <td>${k.revoked ? `<span class="chip err">revoked</span>` : `<span class="chip ok">active</span>`}</td>
      <td class="mut">${esc(k.last_used_at || "never")}</td>
      <td>${k.revoked ? "" : `<form method="post" action="/api-keys/${k.id}/revoke" style="display:inline"><button class="linkbtn" style="color:var(--err)">Revoke</button></form>`}</td>
    </tr>`).join("");

  const body = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div><h1>API keys</h1><p class="sub">Give a key to each order source. They send orders to <code>POST /api/v1/orders</code> with <code>Authorization: Bearer &lt;key&gt;</code>.</p></div>
      <form method="post" action="/api-keys" style="display:flex;gap:8px;align-items:center">
        <input type="text" name="label" placeholder="Label (e.g. Brand A)" style="width:auto">
        <button class="btn sm" type="submit">+ Generate key</button>
      </form>
    </div>
    ${banner}
    <div class="card" style="padding:6px 6px;margin-top:14px">
      <table>
        <thead><tr><th>Label</th><th>Key</th><th>Status</th><th>Last used</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="mut" style="padding:18px">No API keys yet. Generate one to start receiving orders.</td></tr>`}</tbody>
      </table>
    </div>
    <details class="od" style="margin-top:16px"><summary>Sample request</summary>
      <pre>curl -X POST ${esc(env.APP_URL)}/api/v1/orders \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "external_order_id": "BRAND-1234",
    "order_number": "1234",
    "payment_mode": "COD",
    "amount": 529.00,
    "customer": { "name": "Riya Sharma", "phone": "9876543210", "email": "riya@example.com" },
    "address": { "line1": "12 MG Road", "city": "Pune", "state": "Maharashtra", "pincode": "411001", "country": "IN" },
    "pickup": { "name": "Mumbai WH", "contact": "Rahul", "phone": "9820000000", "email": "wh@brand.com",
                "address": "Plot 5, Andheri MIDC", "pincode": "400093", "city": "Mumbai", "state": "Maharashtra" },
    "items": [ { "sku": "TSHIRT-M", "name": "Cotton T-Shirt", "qty": 1, "price": 529.00 } ],
    "weight_kg": 0.4, "length_cm": 25, "width_cm": 20, "height_cm": 4,
    "callback_url": "https://brand.example.com/shipxpeed-webhook"
  }'</pre>
    </details>`;
  return layout("API keys", body, { clientName: client.name ?? client.email, active: "apikeys" });
}

export async function handleCreateApiKey(env: Env, client: Client, req: Request): Promise<Response> {
  const form = await req.formData();
  const label = String(form.get("label") ?? "").trim().slice(0, 60);
  const key = genApiKey();
  const hash = await sha256Hex(key);
  const prefix = key.slice(0, 16);
  await env.DB.prepare(
    `INSERT INTO api_keys (client_id, label, key_prefix, key_hash) VALUES (?, ?, ?, ?)`
  ).bind(client.id, label || null, prefix, hash).run();
  return new Response(await apiKeysPage(env, client, key), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function handleRevokeApiKey(env: Env, client: Client, id: string): Promise<Response> {
  await env.DB.prepare(`UPDATE api_keys SET revoked = 1 WHERE id = ? AND client_id = ?`).bind(id, client.id).run();
  return new Response(null, { status: 302, headers: { Location: "/api-keys" } });
}

// ---------- API orders list page ----------
const STATUS_TABS = ["received", "exported", "placed", "shipped", "delivered", "all"];

export async function apiOrdersPage(env: Env, client: Client, url: URL): Promise<string> {
  const tab = (url.searchParams.get("status") || "received").toLowerCase();
  const q = (url.searchParams.get("q") || "").trim();

  let sql = `SELECT * FROM api_orders WHERE client_id = ?`;
  const binds: any[] = [client.id];
  if (tab !== "all" && STATUS_TABS.includes(tab)) { sql += ` AND status = ?`; binds.push(tab); }
  if (q) { sql += ` AND (external_order_id LIKE ? OR order_number LIKE ? OR awb LIKE ? OR customer_json LIKE ? OR warehouse_name LIKE ?)`; const like = `%${q}%`; binds.push(like, like, like, like, like); }
  sql += ` ORDER BY updated_at DESC LIMIT 500`;
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results ?? [];

  // counts per status
  const cRows = (await env.DB.prepare(
    `SELECT status, COUNT(*) n FROM api_orders WHERE client_id = ? GROUP BY status`
  ).bind(client.id).all()).results ?? [];
  const counts: Record<string, number> = {}; let total = 0;
  for (const r of cRows as any[]) { counts[r.status] = r.n; total += r.n; }

  const tabsHtml = STATUS_TABS.map((t) => {
    const n = t === "all" ? total : (counts[t] || 0);
    const on = t === tab ? "on" : "";
    const label = t.charAt(0).toUpperCase() + t.slice(1);
    return `<a class="ftab ${on}" href="/api-orders?status=${t}${q ? "&q=" + encodeURIComponent(q) : ""}">${label} <span class="fc">${n}</span></a>`;
  }).join("");

  const statusChip = (s: string, awb?: string) => {
    if (s === "delivered" || s === "shipped" || s === "placed") return `<span class="chip ok">${esc(s)}${awb ? " · " + esc(awb) : ""}</span>`;
    if (s === "exported") return `<span class="chip warn">exported</span>`;
    if (s === "error" || s === "cancelled") return `<span class="chip err">${esc(s)}</span>`;
    return `<span class="chip">${esc(s)}</span>`;
  };

  const body = (rows as any[]).map((o) => {
    let cust: any = {}; try { cust = JSON.parse(o.customer_json || "{}"); } catch {}
    let addr: any = {}; try { addr = JSON.parse(o.address_json || "{}"); } catch {}
    return `<tr>
      <td><input type="checkbox" class="rowchk" name="order_ids" value="${o.id}" form="apiproc"></td>
      <td><b>#${esc(o.order_number)}</b><div class="mut">${esc(o.external_order_id)}</div></td>
      <td>${esc(cust.name || "")}<div class="mut">${esc(addr.city || "")}, ${esc(addr.state || "")}</div></td>
      <td>${esc(o.payment_mode)}</td>
      <td>${o.amount ? esc(o.currency) + " " + esc(o.amount) : ""}</td>
      <td>${esc(o.warehouse_name || "")}</td>
      <td>${esc(o.courier || "")}</td>
      <td>${statusChip(o.status, o.awb)}${o.shipment_status ? `<div class="mut">${esc(o.shipment_status)}</div>` : ""}</td>
    </tr>`;
  }).join("");

  const inner = `
    <div><h1>API orders</h1><p class="sub">Orders received from your clients via the API · ${total} total</p></div>
    <div class="ftabs" style="margin-top:14px">${tabsHtml}</div>
    <form method="get" action="/api-orders" style="margin:14px 0;display:flex;gap:8px">
      <input type="hidden" name="status" value="${esc(tab)}">
      <input type="search" name="q" class="tin" value="${esc(q)}" placeholder="Search order #, external id, AWB, customer…" style="flex:1">
      <button class="btn sm" type="submit">Search</button>
    </form>
    <form id="apiproc" method="post" action="/api-orders/process" class="card" style="padding:14px;margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <b>Export selected → Shipxpeed CSV:</b>
      <select name="service_type" style="width:auto"><option>Surface</option><option>Air</option></select>
      <input type="number" step="0.01" name="weight" placeholder="Def. wt (kg)" style="width:110px">
      <input type="number" step="0.1" name="length" placeholder="L" style="width:70px">
      <input type="number" step="0.1" name="width" placeholder="W" style="width:70px">
      <input type="number" step="0.1" name="height" placeholder="H" style="width:70px">
      <input type="text" name="warehouse" placeholder="Fallback warehouse (optional)" style="width:auto">
      <button class="btn sm" type="submit">Export ↓</button>
      <span class="mut" style="font-size:13px">Each order uses its own captured warehouse; the fallback fills any order missing one. Per-order weight/dimensions are used when present, else the defaults.</span>
    </form>
    <div class="card" style="padding:6px 6px">
      <table>
        <thead><tr><th></th><th>Order</th><th>Customer</th><th>Payment</th><th>Amount</th><th>Warehouse</th><th>Courier</th><th>Status</th></tr></thead>
        <tbody>${body || `<tr><td colspan="8" class="mut" style="padding:18px">No orders in this tab.</td></tr>`}</tbody>
      </table>
    </div>`;
  return layout("API orders", inner, { clientName: client.name ?? client.email, active: "apiorders", wide: true });
}

// map a stored api_order row to the Shopify-ish shape buildShipxpeedRows expects
function apiRowToShopifyShape(o: any): any {
  let cust: any = {}; let addr: any = {}; let items: any[] = [];
  try { cust = JSON.parse(o.customer_json || "{}"); } catch {}
  try { addr = JSON.parse(o.address_json || "{}"); } catch {}
  try { items = JSON.parse(o.items_json || "[]"); } catch {}
  return {
    name: `#${o.order_number || o.external_order_id}`,
    email: cust.email || "",
    phone: cust.phone || "",
    total_price: o.amount || "",
    payment_gateway_names: o.payment_mode === "COD" ? ["cod"] : ["prepaid"],
    financial_status: o.payment_mode === "COD" ? "pending" : "paid",
    shipping_address: {
      name: cust.name || "", phone: cust.phone || "",
      address1: addr.line1 || "", address2: addr.line2 || "",
      city: addr.city || "", province: addr.state || "", zip: addr.pincode || "", country: addr.country || "IN",
    },
    line_items: items.map((it) => ({ sku: it.sku, title: it.name, name: it.name, quantity: it.qty, price: it.price })),
  };
}

// ---------- POST /api-orders/process (export selected to Shipxpeed CSV) ----------
export async function handleApiOrdersProcess(env: Env, client: Client, req: Request): Promise<Response> {
  const form = await req.formData();
  const ids = form.getAll("order_ids").map(String).filter(Boolean);
  if (!ids.length) return new Response(null, { status: 302, headers: { Location: "/api-orders" } });

  const fallbackWarehouse = String(form.get("warehouse") ?? "").trim();
  const serviceType = String(form.get("service_type") ?? "Surface").trim();
  const dWeight = String(form.get("weight") ?? "").trim();
  const dLen = String(form.get("length") ?? "").trim();
  const dWid = String(form.get("width") ?? "").trim();
  const dHt = String(form.get("height") ?? "").trim();

  const placeholders = ids.map(() => "?").join(",");
  const rows = (await env.DB.prepare(
    `SELECT * FROM api_orders WHERE client_id = ? AND id IN (${placeholders})`
  ).bind(client.id, ...ids).all()).results ?? [];
  if (!rows.length) return new Response(null, { status: 302, headers: { Location: "/api-orders" } });

  // build CSV rows per-order: each order carries its own captured warehouse name + weight/dims
  const outRows: string[][] = [];
  for (const o of rows as any[]) {
    const m: ManualInput = {
      warehouse: o.warehouse_name || fallbackWarehouse, serviceType,
      weight: (o.weight_kg ?? "") !== "" && o.weight_kg != null ? String(o.weight_kg) : dWeight,
      length: (o.length_cm ?? "") !== "" && o.length_cm != null ? String(o.length_cm) : dLen,
      width: (o.width_cm ?? "") !== "" && o.width_cm != null ? String(o.width_cm) : dWid,
      height: (o.height_cm ?? "") !== "" && o.height_cm != null ? String(o.height_cm) : dHt,
    };
    for (const r of buildShipxpeedRows([apiRowToShopifyShape(o)], m)) outRows.push(r);
  }

  const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [SHIPXPEED_HEADER.map(csvCell).join(",")].concat(outRows.map((r) => r.map(csvCell).join(","))).join("\r\n");

  // mark exported
  await env.DB.prepare(
    `UPDATE api_orders SET status='exported', exported_at=datetime('now'), updated_at=datetime('now')
     WHERE client_id = ? AND id IN (${placeholders}) AND status='received'`
  ).bind(client.id, ...ids).run();

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shipxpeed_api_${stamp}.csv"`,
    },
  });
}

// ---------- Warehouses panel page ----------
export async function warehousesPage(env: Env, client: Client): Promise<string> {
  const rows = (await env.DB.prepare(
    `SELECT w.*, (SELECT COUNT(*) FROM api_orders o WHERE o.warehouse_id = w.id) AS order_count
       FROM warehouses w WHERE w.client_id = ? ORDER BY w.id DESC`
  ).bind(client.id).all()).results ?? [];

  const body = (rows as any[]).map((w) => `
    <tr>
      <td><b>${esc(w.name)}</b></td>
      <td>${esc(w.contact_name || "")}<div class="mut">${esc(w.phone || "")}</div></td>
      <td>${esc(w.address || "")}<div class="mut">${esc(w.city || "")}, ${esc(w.state || "")} ${esc(w.pincode || "")}</div></td>
      <td>${w.shipxpeed_status === "created" ? `<span class="chip ok">created</span>` : `<span class="chip warn">pending</span>`}</td>
      <td>${esc(w.order_count || 0)}</td>
    </tr>`).join("");

  const inner = `
    <div><h1>Warehouses</h1><p class="sub">Pickup addresses captured from incoming orders. Each unique pickup becomes one warehouse — the name is what we push into the Shipxpeed sheet.</p></div>
    <div class="card" style="padding:6px 6px;margin-top:14px">
      <table>
        <thead><tr><th>Name</th><th>Contact</th><th>Pickup address</th><th>Shipxpeed</th><th>Orders</th></tr></thead>
        <tbody>${body || `<tr><td colspan="5" class="mut" style="padding:18px">No warehouses yet. They're created automatically from the pickup details on incoming orders.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="mut" style="margin-top:12px;font-size:13px"><b>pending</b> = not yet created in the Shipxpeed panel; <b>created</b> = exists in Shipxpeed and safe to use in the bulk sheet.</p>`;
  return layout("Warehouses", inner, { clientName: client.name ?? client.email, active: "warehouses", wide: true });
}
