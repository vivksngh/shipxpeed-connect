import {
  hashPassword,
  verifyPassword,
  verifyShopifyHmac,
  randomToken,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  normalizeShopDomain,
} from "./auth";
import type { Env } from "./shopify";
import {
  buildAuthorizeUrl,
  exchangeToken,
  fetchAllOrders,
  fetchShopInfo,
  findOrderIdByName,
  fulfillWithTracking,
} from "./shopify";
import { buildShipxpeedCsv, type ManualInput } from "./export";
import {
  layout,
  loginPage,
  setupPage,
  dashboardPage,
  connectPage,
  ordersPage,
  importPage,
} from "./html";

const SESSION_TTL = 60 * 60 * 24 * 14; // 14 days

// ---------- small helpers ----------
function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } });
}
function htmlResponse(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
}

interface Client { id: number; email: string; name: string | null; is_admin: number; }

async function getSessionClient(req: Request, env: Env): Promise<Client | null> {
  const sid = parseCookies(req.headers.get("Cookie"))["sid"];
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT c.id, c.email, c.name, c.is_admin
       FROM sessions s JOIN clients c ON c.id = s.client_id
      WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(sid).first<Client>();
  return row ?? null;
}

async function getStoreForClient(env: Env, storeId: string, clientId: number): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM stores WHERE id = ? AND client_id = ?`)
    .bind(storeId, clientId).first();
}

// naive CSV parser (handles quotes and commas)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------- main fetch handler ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // public routes
      if (path === "/" ) {
        const c = await getSessionClient(req, env);
        return redirect(c ? "/dashboard" : "/login");
      }
      if (path === "/login" && method === "GET") {
        const c = await getSessionClient(req, env);
        if (c) return redirect("/dashboard");
        return htmlResponse(loginPage());
      }
      if (path === "/login" && method === "POST") return handleLogin(req, env);
      if (path === "/logout" && method === "POST") return handleLogout(req, env);
      if (path === "/setup" && method === "GET") {
        const key = url.searchParams.get("key") ?? "";
        if (key !== env.SESSION_SECRET) return htmlResponse(errPage("Setup key required. Open this page as /setup?key=YOUR_SESSION_SECRET"), 403);
        return htmlResponse(setupPage(key));
      }
      if (path === "/setup" && method === "POST") return handleSetup(req, env);
      if (path === "/auth/shopify/callback" && method === "GET") return handleCallback(req, env, url);
      if (path === "/healthz") return new Response("ok");

      // authenticated routes
      const client = await getSessionClient(req, env);
      if (!client) return redirect("/login");

      if (path === "/dashboard" && method === "GET") {
        const stores = (await env.DB.prepare(
          `SELECT * FROM stores WHERE client_id = ? ORDER BY id DESC`
        ).bind(client.id).all()).results ?? [];
        return htmlResponse(dashboardPage(client.name ?? client.email, stores));
      }
      if (path === "/connect" && method === "GET") return htmlResponse(connectPage(client.name ?? client.email, undefined, undefined, env.APP_URL));
      if (path === "/connect" && method === "POST") return handleConnect(req, env, client);
      if (path === "/connect/oauth-app" && method === "POST") return handleConnectOauthApp(req, env, client);
      if (path === "/connect/token" && method === "GET") return htmlResponse(connectPage(client.name ?? client.email, undefined, undefined, env.APP_URL));
      if (path === "/connect/token" && method === "POST") return handleConnectToken(req, env, client);

      const m = path.match(/^\/store\/(\d+)\/(orders|reconnect|process|import|delete|junk)$/);
      if (m) {
        const storeId = m[1], action = m[2];
        const store = await getStoreForClient(env, storeId, client.id);
        if (!store) return htmlResponse(layout("Not found", `<div class="card"><h1>Store not found</h1><p><a href="/dashboard">Back</a></p></div>`, { clientName: client.name ?? client.email }), 404);

        if (action === "reconnect" && method === "GET") {
          // Re-run OAuth using the store's own app credentials if it was connected that way,
          // otherwise fall back to the shared app.
          const creds = store.api_key && store.api_secret
            ? { apiKey: String(store.api_key), apiSecret: String(store.api_secret) }
            : undefined;
          return startOAuth(env, client, store.shop_domain, creds);
        }
        if (action === "delete" && method === "POST") {
          await env.DB.prepare(`DELETE FROM stores WHERE id = ?`).bind(store.id).run();
          return redirect("/dashboard");
        }
        if (action === "orders" && method === "GET") return handleOrders(env, client, store);
        if (action === "junk" && method === "POST") return handleJunk(req, env, store);
        if (action === "process" && method === "POST") return handleProcess(req, env, client, store);
        if (action === "import" && method === "GET") return htmlResponse(importPage(client.name ?? client.email, store));
        if (action === "import" && method === "POST") return handleImport(req, env, client, store);
      }

      return htmlResponse(layout("Not found", `<div class="card"><h1>404</h1><p><a href="/dashboard">Home</a></p></div>`, { clientName: client.name ?? client.email }), 404);
    } catch (err: any) {
      return htmlResponse(
        layout("Error", `<div class="card"><h1>Something went wrong</h1><p class="muted">${(err?.message ?? "Unknown error").toString().replace(/</g, "&lt;")}</p><p><a href="/dashboard">Back</a></p></div>`),
        500
      );
    }
  },
};

// ---------- handlers ----------
async function handleLogin(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const client = await env.DB.prepare(`SELECT * FROM clients WHERE email = ?`).bind(email).first<any>();
  if (!client || !(await verifyPassword(password, client.password_hash))) {
    return htmlResponse(loginPage("Invalid email or password."), 401);
  }
  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (id, client_id, expires_at) VALUES (?, ?, datetime('now', ?))`
  ).bind(token, client.id, `+${SESSION_TTL} seconds`).run();
  return redirect("/dashboard", { "Set-Cookie": sessionCookie(token, SESSION_TTL) });
}

async function handleSetup(req: Request, env: Env): Promise<Response> {
  const form = await req.formData();
  const key = String(form.get("key") ?? "");
  if (key !== env.SESSION_SECRET) return htmlResponse(errPage("Invalid setup key."), 403);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || password.length < 6) return htmlResponse(setupPage(key, "Email and a password of at least 6 characters are required."), 400);
  const existing = await env.DB.prepare(`SELECT id FROM clients WHERE email = ?`).bind(email).first();
  if (existing) return htmlResponse(setupPage(key, "A client with that email already exists."), 400);
  const hash = await hashPassword(password);
  await env.DB.prepare(`INSERT INTO clients (email, name, password_hash) VALUES (?, ?, ?)`).bind(email, name, hash).run();
  return htmlResponse(loginPage(undefined, "Client login created — you can sign in now."));
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const sid = parseCookies(req.headers.get("Cookie"))["sid"];
  if (sid) await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sid).run();
  return redirect("/login", { "Set-Cookie": clearSessionCookie() });
}

async function handleConnect(req: Request, env: Env, client: Client): Promise<Response> {
  const form = await req.formData();
  const shop = normalizeShopDomain(String(form.get("shop") ?? ""));
  if (!shop) return htmlResponse(connectPage(client.name ?? client.email, "Please enter a valid .myshopify.com domain.", undefined, env.APP_URL), 400);
  return startOAuth(env, client, shop);
}

// Connect a store using its OWN Shopify app credentials (Client ID + secret), via OAuth.
// Each store's app is custom-distributed to that store, so no Shopify review is needed.
async function handleConnectOauthApp(req: Request, env: Env, client: Client): Promise<Response> {
  const name = client.name ?? client.email;
  const form = await req.formData();
  const shop = normalizeShopDomain(String(form.get("shop") ?? ""));
  const apiKey = String(form.get("api_key") ?? "").trim();
  const apiSecret = String(form.get("api_secret") ?? "").trim();
  if (!shop) return htmlResponse(connectPage(name, "Please enter a valid .myshopify.com domain.", undefined, env.APP_URL), 400);
  if (!apiKey || !apiSecret) return htmlResponse(connectPage(name, "Please enter both the Client ID and Client secret from the store's app.", undefined, env.APP_URL), 400);
  return startOAuth(env, client, shop, { apiKey, apiSecret });
}

// Connect a store directly with an Admin API access token (no OAuth / no app review).
async function handleConnectToken(req: Request, env: Env, client: Client): Promise<Response> {
  const name = client.name ?? client.email;
  const form = await req.formData();
  const shop = normalizeShopDomain(String(form.get("shop") ?? ""));
  const token = String(form.get("token") ?? "").trim();
  if (!shop) return htmlResponse(connectPage(name, "Please enter a valid .myshopify.com domain.", undefined, env.APP_URL), 400);
  if (!token) return htmlResponse(connectPage(name, "Please paste the Admin API access token (starts with shpat_).", undefined, env.APP_URL), 400);

  // Validate the token by calling the Shop endpoint.
  const info = await fetchShopInfo(shop, token, env.SHOPIFY_API_VERSION);
  if (!info) {
    return htmlResponse(
      connectPage(name, "Couldn't connect with that token. Check the store domain and token, and that the custom app is installed with order + fulfillment scopes.", undefined, env.APP_URL),
      400
    );
  }

  await env.DB.prepare(
    `INSERT INTO stores (client_id, shop_domain, access_token, status, oauth_state, installed_at)
     VALUES (?, ?, ?, 'connected', NULL, datetime('now'))
     ON CONFLICT(client_id, shop_domain)
     DO UPDATE SET access_token = excluded.access_token, status = 'connected', oauth_state = NULL, installed_at = datetime('now')`
  ).bind(client.id, shop, token).run();

  const store = await env.DB.prepare(`SELECT id FROM stores WHERE client_id = ? AND shop_domain = ?`)
    .bind(client.id, shop).first<any>();
  if (!store) return htmlResponse(connectPage(name, "Saved, but couldn't reopen the store. Go back to your dashboard.", undefined, env.APP_URL), 500);
  return redirect(`/store/${store.id}/orders`);
}

async function startOAuth(
  env: Env,
  client: Client,
  shop: string,
  creds?: { apiKey: string; apiSecret: string }
): Promise<Response> {
  const state = randomToken(16);
  const apiKey = creds?.apiKey || env.SHOPIFY_API_KEY;
  // Store per-store credentials (null when using the shared app) alongside the state.
  await env.DB.prepare(
    `INSERT INTO stores (client_id, shop_domain, oauth_state, status, api_key, api_secret)
     VALUES (?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(client_id, shop_domain)
     DO UPDATE SET oauth_state = excluded.oauth_state, api_key = excluded.api_key, api_secret = excluded.api_secret`
  ).bind(client.id, shop, state, creds?.apiKey ?? null, creds?.apiSecret ?? null).run();
  const redirectUri = `${env.APP_URL}/auth/shopify/callback`;
  return redirect(buildAuthorizeUrl(shop, apiKey, env.SHOPIFY_SCOPES, redirectUri, state));
}

async function handleCallback(req: Request, env: Env, url: URL): Promise<Response> {
  const params = url.searchParams;
  const shop = normalizeShopDomain(params.get("shop") ?? "") || (params.get("shop") ?? "");
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  if (!normalizeShopDomain(shop) || !code) return htmlResponse(errPage("Invalid callback parameters."), 400);

  // Find the store for this shop. Prefer an exact state match, but fall back to the most
  // recent record for this shop so retries / Shopify-initiated installs still work
  // (authenticity is guaranteed by the HMAC check below, not by the state alone).
  let store =
    (state
      ? await env.DB.prepare(`SELECT * FROM stores WHERE shop_domain = ? AND oauth_state = ?`).bind(shop, state).first<any>()
      : null) ??
    (await env.DB.prepare(`SELECT * FROM stores WHERE shop_domain = ? ORDER BY id DESC LIMIT 1`).bind(shop).first<any>());
  if (!store) return htmlResponse(errPage("No matching connection request for this store. Start the connect again from your dashboard."), 400);

  const apiKey = store.api_key || env.SHOPIFY_API_KEY;
  const apiSecret = store.api_secret || env.SHOPIFY_API_SECRET;
  if (!(await verifyShopifyHmac(params, apiSecret))) return htmlResponse(errPage("HMAC verification failed."), 400);

  const tok = await exchangeToken(shop, apiKey, apiSecret, code);
  await env.DB.prepare(
    `UPDATE stores SET access_token = ?, scope = ?, status = 'connected', oauth_state = NULL, installed_at = datetime('now') WHERE id = ?`
  ).bind(tok.access_token, tok.scope, store.id).run();
  return redirect(`/store/${store.id}/orders`);
}

async function handleOrders(env: Env, client: Client, store: any): Promise<Response> {
  if (!store.access_token) return redirect(`/store/${store.id}/reconnect`);
  const orders = await fetchAllOrders(store.shop_domain, store.access_token, env.SHOPIFY_API_VERSION, { status: "any" });
  const procRows = (await env.DB.prepare(`SELECT * FROM order_processing WHERE store_id = ?`).bind(store.id).all()).results ?? [];
  const procMap: Record<string, any> = {};
  for (const p of procRows as any[]) procMap[String(p.shopify_order_id)] = p;
  return htmlResponse(ordersPage(client.name ?? client.email, store, orders, procMap));
}

// Move an order to / from the Cancelled/Junk tab (manual junk flag).
async function handleJunk(req: Request, env: Env, store: any): Promise<Response> {
  const form = await req.formData();
  const orderId = String(form.get("order_id") ?? "").trim();
  const op = String(form.get("op") ?? "junk").trim();
  if (orderId) {
    const junk = op === "unjunk" ? 0 : 1;
    await env.DB.prepare(
      `INSERT INTO order_processing (store_id, shopify_order_id, status, junk, updated_at)
       VALUES (?, ?, 'pending', ?, datetime('now'))
       ON CONFLICT(store_id, shopify_order_id)
       DO UPDATE SET junk=excluded.junk, updated_at=datetime('now')`
    ).bind(store.id, orderId, junk).run();
  }
  return redirect(`/store/${store.id}/orders`);
}

// Phase 4 — process selected orders into the Shipxpeed Bulk B2C export sheet.
async function handleProcess(req: Request, env: Env, client: Client, store: any): Promise<Response> {
  const form = await req.formData();
  const ids = new Set(form.getAll("order_ids").map(String));
  if (ids.size === 0) return redirect(`/store/${store.id}/orders`);

  const manual: ManualInput = {
    warehouse: String(form.get("warehouse") ?? "").trim(),
    serviceType: String(form.get("service_type") ?? "Surface").trim(),
    weight: String(form.get("weight") ?? "").trim(),
    length: String(form.get("length") ?? "").trim(),
    width: String(form.get("width") ?? "").trim(),
    height: String(form.get("height") ?? "").trim(),
  };
  // required manual inputs
  if (!manual.warehouse || !manual.weight || !manual.length || !manual.width || !manual.height) {
    return redirect(`/store/${store.id}/orders`);
  }

  const all = await fetchAllOrders(store.shop_domain, store.access_token, env.SHOPIFY_API_VERSION, { status: "any" });
  const selected = all.filter((o) => ids.has(String(o.id)));
  if (selected.length === 0) return redirect(`/store/${store.id}/orders`);

  const csv = buildShipxpeedCsv(selected, manual);

  for (const o of selected) {
    await env.DB.prepare(
      `INSERT INTO order_processing (store_id, shopify_order_id, order_number, status, exported_at, updated_at)
       VALUES (?, ?, ?, 'exported', datetime('now'), datetime('now'))
       ON CONFLICT(store_id, shopify_order_id)
       DO UPDATE SET status='exported', order_number=excluded.order_number, exported_at=datetime('now'), updated_at=datetime('now')`
    ).bind(store.id, String(o.id), o.name).run();
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shipxpeed_bulk_${store.shop_domain}_${stamp}.csv"`,
    },
  });
}

// Phase 5 — import the updates sheet (Shopify Order Number, AWB, Shipment Status, Courier Name).
// Matches each row to its order, stores AWB/status, and marks the order fulfilled in Shopify
// with the AWB as tracking number + courier as the carrier.
async function handleImport(req: Request, env: Env, client: Client, store: any): Promise<Response> {
  const name = client.name ?? client.email;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return htmlResponse(importPage(name, store, "Please choose a CSV file."), 400);
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return htmlResponse(importPage(name, store, "The file looks empty."), 400);

  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idIdx = head.findIndex((h) => h.includes("order"));
  const awbIdx = head.findIndex((h) => h.includes("awb") || h.includes("tracking"));
  const stIdx = head.findIndex((h) => h.includes("status"));
  const courierIdx = head.findIndex((h) => h.includes("courier") || h.includes("carrier"));
  if (idIdx === -1 || awbIdx === -1) {
    return htmlResponse(importPage(name, store, "Couldn't find the Order Number and AWB columns. Expected headers: Shopify Order Number, AWB, Shipment Status, Courier Name."), 400);
  }

  let stored = 0, fulfilled = 0, failed = 0;
  const errors: string[] = [];

  for (const r of rows.slice(1)) {
    const num = (r[idIdx] ?? "").trim();
    const awb = (r[awbIdx] ?? "").trim();
    const status = stIdx >= 0 ? (r[stIdx] ?? "").trim() : "";
    const courier = courierIdx >= 0 ? (r[courierIdx] ?? "").trim() : "";
    if (!num) continue;
    const clean = num.replace(/^#/, "");

    // resolve the Shopify order id (from our export record first, else look it up by name)
    let oid: string | null = null;
    const rec = await env.DB.prepare(
      `SELECT shopify_order_id, status FROM order_processing WHERE store_id = ? AND (order_number = ? OR order_number = ?)`
    ).bind(store.id, `#${clean}`, clean).first<any>();
    if (rec && !String(rec.shopify_order_id).startsWith("name:")) oid = String(rec.shopify_order_id);
    if (!oid) oid = await findOrderIdByName(store.shop_domain, store.access_token, env.SHOPIFY_API_VERSION, num);
    const alreadyFulfilled = rec?.status === "fulfilled";

    // store the AWB/status regardless
    await env.DB.prepare(
      `INSERT INTO order_processing (store_id, shopify_order_id, order_number, awb, shipment_status, status, updated_at)
       VALUES (?, ?, ?, ?, ?, 'shipped', datetime('now'))
       ON CONFLICT(store_id, shopify_order_id)
       DO UPDATE SET awb=excluded.awb, shipment_status=excluded.shipment_status, order_number=excluded.order_number, updated_at=datetime('now')`
    ).bind(store.id, oid ?? `name:${clean}`, `#${clean}`, awb, status).run();
    stored++;

    // fulfill in Shopify when we have both an order id and an AWB (skip if already fulfilled — status sync only)
    if (oid && awb && !alreadyFulfilled) {
      const res = await fulfillWithTracking(store.shop_domain, store.access_token, env.SHOPIFY_API_VERSION, oid, awb, courier);
      if (res.ok) {
        fulfilled++;
        await env.DB.prepare(`UPDATE order_processing SET status='fulfilled', fulfilled_at=datetime('now') WHERE store_id=? AND shopify_order_id=?`).bind(store.id, oid).run();
      } else {
        failed++;
        if (errors.length < 8) errors.push(`#${clean}: ${res.msg}`);
      }
    } else if (!oid) {
      failed++;
      if (errors.length < 8) errors.push(`#${clean}: order not found in Shopify`);
    }
  }

  const summary = `Imported ${stored} row(s) · ${fulfilled} fulfilled in Shopify${failed ? ` · ${failed} need attention` : ""}.`;
  const errHtml = errors.length ? `Issues — ${errors.join(" | ")}` : undefined;
  return htmlResponse(importPage(name, store, errHtml, summary));
}

function errPage(msg: string): string {
  return layout("Connection error", `<div class="center"><div class="card"><h1>Connection error</h1><div class="err">${msg.replace(/</g, "&lt;")}</div><p><a href="/dashboard">Back to dashboard</a></p></div></div>`);
}
