// Automation endpoints — consumed by the external Playwright orchestrator that drives
// the Shipxpeed panel. Authenticated with a single automation token whose sha256 is
// stored in app_settings('automation_token_hash'). All endpoints are cross-client
// (one Shipxpeed reseller account ships every client's orders).

import type { Env } from "./shopify";
import { buildShipxpeedRows, SHIPXPEED_HEADER } from "./export";

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

// ---------- auth ----------
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

// ---------- GET /automation/pending-warehouses ----------
export async function handlePendingWarehouses(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  const rows = (await env.DB.prepare(
    `SELECT id, client_id, name, contact_name, phone, email, address, pincode, city, state
       FROM warehouses WHERE shipxpeed_status = 'pending' ORDER BY id`
  ).all()).results ?? [];
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

// map a stored api_order row to the Shopify-ish shape buildShipxpeedRows expects
function apiRowToShopifyShape(o: any): any {
  let cust: any = {}, addr: any = {}, items: any[] = [];
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

// ---------- GET /automation/export ----------
// Shipxpeed-format CSV of 'received' orders whose warehouse already exists in Shipxpeed.
// Marks the included orders 'exported'. Header-only CSV when there is nothing to ship.
export async function handleAutomationExport(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  const rows = (await env.DB.prepare(
    `SELECT o.* FROM api_orders o
       JOIN warehouses w ON w.id = o.warehouse_id
      WHERE o.status = 'received' AND w.shipxpeed_status = 'created'
      ORDER BY o.id LIMIT 500`
  ).all()).results ?? [];

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
      warehouse: o.warehouse_name || "",
      serviceType: "Surface",
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

// map a Shipxpeed status string to our order status vocabulary
function mapStatus(s: string): string | null {
  const x = String(s ?? "").toLowerCase();
  if (!x) return null;
  if (x.includes("deliver")) return "delivered";
  if (x.includes("transit") || x.includes("shipped") || x.includes("out for") || x.includes("pickup") || x.includes("dispatch")) return "shipped";
  if (x.includes("assign") || x.includes("placed") || x.includes("manifest") || x.includes("booked")) return "placed";
  if (x.includes("cancel") || x.includes("rto")) return "cancelled";
  return null; // unknown -> leave status unchanged
}

// ---------- POST /automation/writeback ----------
// body: { updates: [ { ref, awb, courier, status, shipment_status } ] }
// ref is the Shipxpeed "Order Reference" — our "#<order_number>"; match on order_number or external_order_id.
export async function handleWriteback(req: Request, env: Env): Promise<Response> {
  if (!(await authAutomation(req, env))) return json({ error: "unauthorized" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
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

    const res = await env.DB.prepare(
      `UPDATE api_orders
          SET awb = COALESCE(?, awb),
              courier = COALESCE(?, courier),
              shipment_status = COALESCE(?, shipment_status),
              status = COALESCE(?, status),
              placed_at = CASE WHEN placed_at IS NULL AND ? IS NOT NULL THEN datetime('now') ELSE placed_at END,
              updated_at = datetime('now')
        WHERE order_number = ? OR external_order_id = ?`
    ).bind(awb, courier, shipment, newStatus, awb, ref, ref).run();

    const changes = (res as any)?.meta?.changes ?? 0;
    if (changes > 0) matched++; else { missed++; if (misses.length < 20) misses.push(ref); }
  }
  return json({ matched, missed, misses });
}
