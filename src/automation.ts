// Automation endpoints — consumed by the external Playwright orchestrator that drives
// the Shipxpeed panel, plus the in-panel "Shipxpeed login" settings page.
//
// Model: each CLIENT has their own Shipxpeed account. The client saves their Shipxpeed
// email/password in the panel (Settings page). The orchestrator asks the app which clients
// have credentials, then logs into each client's Shipxpeed account and processes only that
// client's warehouses and orders.
//
// The automation endpoints are authenticated with a single automation token whose sha256
// is stored in app_settings('automation_token_hash').

import type { Env } from "./shopify";
import { layout } from "./html";
import { buildShipxpeedRows, SHIPXPEED_HEADER } from "./export";

interface Client { id: number; email: string; name: string | null; is_admin: number; }

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
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ---------- automation-token auth ----------
export async function authAutomation(req: Request, env: Env): Promise<boolean> {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const hash = await sha256Hex(m[1].trim());
  const row = await env.DB.prepare(
    `SELECT value FROM app_settings WHERE key = 'automation_token_hash'`
  ).first<{ value: string }>();
  return !!row && row.value === hash;
}

// ---------- GET /automation/clients ----------
// Clients that have Shipxpeed credentials saved. The orchestrator logs into each.
export async function handleClientsList(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  const credRows = (await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key LIKE 'shipxpeed_creds:%'`
  ).all()).results ?? [];
  const nameRows = (await env.DB.prepare(`SELECT id, name, email FROM clients`).all()).results ?? [];
  const names: Record<string, string> = {};
  for (const c of nameRows as any[]) names[String(c.id)] = c.name || c.email;
  const clients: any[] = [];
  for (const r of credRows as any[]) {
    const id = Number(String(r.key).split(":")[1]);
    let creds: any = {};
    try { creds = JSON.parse(r.value || "{}"); } catch {}
    if (creds.email && creds.password) {
      clients.push({ id, name: names[String(id)] || `#${id}`, shipxpeed_email: creds.email, shipxpeed_password: creds.password });
    }
  }
  return json({ count: clients.length, clients });
}

// ---------- GET /automation/pending-warehouses?client_id= ----------
export async function handlePendingWarehouses(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  const clientId = new URL(req.url).searchParams.get("client_id");
  let sql = `SELECT id, client_id, name, contact_name, phone, email, address, pincode, city, state
               FROM warehouses WHERE shipxpeed_status = 'pending'`;
  const binds: any[] = [];
  if (clientId) { sql += ` AND client_id = ?`; binds.push(clientId); }
  sql += ` ORDER BY id`;
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results ?? [];
  return json({ count: rows.length, warehouses: rows });
}

// ---------- POST /automation/warehouse-created  { ids:[...] } ----------
export async function handleWarehouseCreated(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const ids: any[] = Array.isArray(body?.ids) ? body.ids : [];
  let updated = 0;
  for (const id of ids) {
    await env.DB.prepare(
      `UPDATE warehouses SET shipxpeed_status = 'created', updated_at = datetime('now') WHERE id = ?`
    ).bind(id).run();
    updated++;
  }
  return json({ updated });
}

function apiRowToShopifyShape(o: any): any {
  let cust: any = {}, addr: any = {}, items: any[] = [];
  try { cust = JSON.parse(o.customer_json || "{}"); } catch {}
  try { addr = JSON.parse(o.address_json || "{}"); } catch {}
  try { items = JSON.parse(o.items_json || "[]"); } catch {}
  return {
    name: `#${o.order_number || o.external_order_id}`,
    email: cust.email || "", phone: cust.phone || "",
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

// ---------- GET /automation/export?client_id= ----------
// Shipxpeed-format CSV of a client's 'received' orders whose warehouse already exists in Shipxpeed.
export async function handleAutomationExport(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  const clientId = new URL(req.url).searchParams.get("client_id");
  let sql = `SELECT o.* FROM api_orders o
               JOIN warehouses w ON w.id = o.warehouse_id
              WHERE o.status = 'received' AND w.shipxpeed_status = 'created'`;
  const binds: any[] = [];
  if (clientId) { sql += ` AND o.client_id = ?`; binds.push(clientId); }
  sql += ` ORDER BY o.id LIMIT 500`;
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results ?? [];

  const headerLine = SHIPXPEED_HEADER.map(csvCell).join(",");
  if (!rows.length) {
    return new Response(headerLine + "\r\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "X-Order-Count": "0" },
    });
  }

  const outRows: string[][] = [];
  const ids: number[] = [];
  for (const o of rows as any[]) {
    const m = {
      warehouse: o.warehouse_name || "", serviceType: "Surface",
      weight: o.weight_kg != null ? String(o.weight_kg) : "",
      length: o.length_cm != null ? String(o.length_cm) : "",
      width: o.width_cm != null ? String(o.width_cm) : "",
      height: o.height_cm != null ? String(o.height_cm) : "",
    };
    for (const r of buildShipxpeedRows([apiRowToShopifyShape(o)], m)) outRows.push(r);
    ids.push(o.id);
  }
  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(
    `UPDATE api_orders SET status = 'exported', exported_at = datetime('now'), updated_at = datetime('now')
      WHERE id IN (${placeholders}) AND status = 'received'`
  ).bind(...ids).run();

  const csv = [headerLine].concat(outRows.map((r) => r.map(csvCell).join(","))).join("\r\n");
  return new Response(csv + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "X-Order-Count": String(ids.length),
      "Content-Disposition": `attachment; filename="vrc_export.csv"`,
    },
  });
}

function mapStatus(s: string): string | null {
  const x = String(s ?? "").toLowerCase();
  if (!x) return null;
  if (x.includes("deliver")) return "delivered";
  if (x.includes("transit") || x.includes("shipped") || x.includes("out for") || x.includes("pickup") || x.includes("dispatch")) return "shipped";
  if (x.includes("assign") || x.includes("placed") || x.includes("manifest") || x.includes("booked")) return "placed";
  if (x.includes("cancel") || x.includes("rto")) return "cancelled";
  return null;
}

// ---------- POST /automation/writeback  { client_id, updates:[{ref,awb,courier,status,shipment_status}] } ----------
export async function handleWriteback(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const clientId = body?.client_id != null ? Number(body.client_id) : null;
  const updates: any[] = Array.isArray(body?.updates) ? body.updates : [];

  let matched = 0, missed = 0;
  const misses: string[] = [];
  for (const u of updates) {
    const ref = String(u?.ref ?? "").trim().replace(/^#/, "");
    if (!ref) continue;
    const awb = String(u?.awb ?? "").trim() || null;
    const courier = String(u?.courier ?? "").trim() || null;
    const shipment = String(u?.shipment_status ?? u?.status ?? "").trim() || null;
    const newStatus = mapStatus(String(u?.status ?? u?.shipment_status ?? ""));

    let sql = `UPDATE api_orders
                  SET awb = COALESCE(?, awb), courier = COALESCE(?, courier),
                      shipment_status = COALESCE(?, shipment_status), status = COALESCE(?, status),
                      placed_at = CASE WHEN placed_at IS NULL AND ? IS NOT NULL THEN datetime('now') ELSE placed_at END,
                      updated_at = datetime('now')
                WHERE (order_number = ? OR external_order_id = ?)`;
    const binds: any[] = [awb, courier, shipment, newStatus, awb, ref, ref];
    if (clientId != null) { sql += ` AND client_id = ?`; binds.push(clientId); }
    const res = await env.DB.prepare(sql).bind(...binds).run();
    const changes = (res as any)?.meta?.changes ?? 0;
    if (changes > 0) matched++; else { missed++; if (misses.length < 20) misses.push(ref); }
  }
  return json({ matched, missed, misses });
}

// ================= Panel: Shipxpeed login settings (cookie-auth) =================

export async function settingsPage(env: Env, client: Client, saved?: boolean): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT value FROM app_settings WHERE key = ?`
  ).bind(`shipxpeed_creds:${client.id}`).first<{ value: string }>();
  let creds: any = {};
  try { creds = JSON.parse(row?.value || "{}"); } catch {}
  const email = creds.email || "";
  const hasPass = !!creds.password;

  const banner = saved
    ? `<div class="card" style="border-color:var(--ok);background:#12241b;margin-bottom:14px"><b>Saved.</b> The automation will use these to log in to your Shipxpeed account.</div>`
    : "";

  const body = `
    <div><h1>Shipxpeed login</h1><p class="sub">Save your Shipxpeed seller-panel login. The automation signs in with these to create shipments and pull tracking. Stored only for your account.</p></div>
    ${banner}
    <div class="card" style="max-width:520px">
      <form method="post" action="/settings">
        <label>Shipxpeed email</label>
        <input type="email" name="shipxpeed_email" value="${esc(email)}" placeholder="you@example.com" required>
        <label style="margin-top:12px;display:block">Shipxpeed password</label>
        <input type="password" name="shipxpeed_password" placeholder="${hasPass ? "•••••••• (saved — type to replace)" : "your Shipxpeed password"}" ${hasPass ? "" : "required"}>
        <p class="mut" style="font-size:13px;margin-top:8px">Leave the password blank to keep the one already saved.</p>
        <button class="btn" type="submit" style="margin-top:12px">Save Shipxpeed login</button>
      </form>
    </div>`;
  return layout("Shipxpeed login", body, { clientName: client.name ?? client.email, active: "settings" });
}

export async function handleSaveSettings(env: Env, client: Client, req: Request): Promise<Response> {
  const form = await req.formData();
  const email = String(form.get("shipxpeed_email") ?? "").trim();
  const pass = String(form.get("shipxpeed_password") ?? "");
  const key = `shipxpeed_creds:${client.id}`;
  const existingRow = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(key).first<{ value: string }>();
  let existing: any = {};
  try { existing = JSON.parse(existingRow?.value || "{}"); } catch {}
  const password = pass || existing.password || "";
  await env.DB.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`
  ).bind(key, JSON.stringify({ email, password })).run();
  return new Response(await settingsPage(env, client, true), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
