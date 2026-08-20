// Shopify OAuth + Admin API helpers (zero-dependency).

export interface Env {
  DB: D1Database;
  APP_URL: string;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_SCOPES: string;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SESSION_SECRET: string;
}

export function buildAuthorizeUrl(
  shop: string,
  apiKey: string,
  scopes: string,
  redirectUri: string,
  state: string
): string {
  const p = new URLSearchParams({
    client_id: apiKey,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
    "grant_options[]": "",
  });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

export async function exchangeToken(
  shop: string,
  apiKey: string,
  apiSecret: string,
  code: string
): Promise<{ access_token: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as { access_token: string; scope: string };
}

// Mint an Admin API access token via the client-credentials grant (no OAuth redirect).
// Works for an app developed in your own org and installed on a store you own.
// The returned token is short-lived (~24h), so callers should mint fresh on demand.
export async function mintAppToken(
  shop: string,
  apiKey: string,
  apiSecret: string
): Promise<string | null> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: apiSecret,
    }).toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export function apiBase(shop: string, version: string): string {
  return `https://${shop}/admin/api/${version}`;
}

export async function shopifyGet(
  shop: string,
  token: string,
  version: string,
  pathAndQuery: string
): Promise<Response> {
  return fetch(`${apiBase(shop, version)}${pathAndQuery}`, {
    headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
  });
}

export async function shopifyPost(
  shop: string,
  token: string,
  version: string,
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${apiBase(shop, version)}${path}`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Parse the Link header to find the next page_info cursor.
function nextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    if (part.includes('rel="next"')) {
      const m = part.match(/[?&]page_info=([^&>]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
  }
  return null;
}

// Fetch orders with full detail, following pagination. `maxPages` caps runaway loops.
export async function fetchAllOrders(
  shop: string,
  token: string,
  version: string,
  opts: { status?: string; financial_status?: string; fulfillment_status?: string; maxPages?: number } = {}
): Promise<any[]> {
  const status = opts.status ?? "any";
  const maxPages = opts.maxPages ?? 10; // 10 * 250 = 2500 orders
  const orders: any[] = [];
  // First page carries filters; subsequent pages use only page_info + limit.
  let query = `/orders.json?status=${encodeURIComponent(status)}&limit=250`;
  if (opts.financial_status) query += `&financial_status=${encodeURIComponent(opts.financial_status)}`;
  if (opts.fulfillment_status) query += `&fulfillment_status=${encodeURIComponent(opts.fulfillment_status)}`;

  for (let page = 0; page < maxPages; page++) {
    const res = await shopifyGet(shop, token, version, query);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Orders fetch failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { orders?: any[] };
    if (data.orders?.length) orders.push(...data.orders);
    const next = nextPageInfo(res.headers.get("Link"));
    if (!next) break;
    query = `/orders.json?limit=250&page_info=${encodeURIComponent(next)}`;
  }
  return orders;
}

// Fetch a single order with all fields.
export async function fetchOrder(
  shop: string,
  token: string,
  version: string,
  orderId: string
): Promise<any | null> {
  const res = await shopifyGet(shop, token, version, `/orders/${orderId}.json`);
  if (!res.ok) return null;
  const data = (await res.json()) as { order?: any };
  return data.order ?? null;
}

// Verify the token still works + return shop info.
export async function fetchShopInfo(
  shop: string,
  token: string,
  version: string
): Promise<any | null> {
  const res = await shopifyGet(shop, token, version, `/shop.json`);
  if (!res.ok) return null;
  const data = (await res.json()) as { shop?: any };
  return data.shop ?? null;
}

// ---------- fulfillment write-back ----------

// Resolve a Shopify order id from an order number/name like "#1001" or "1001".
export async function findOrderIdByName(
  shop: string,
  token: string,
  version: string,
  name: string
): Promise<string | null> {
  const clean = name.trim().replace(/^#/, "");
  const q = encodeURIComponent(`#${clean}`);
  const res = await shopifyGet(shop, token, version, `/orders.json?status=any&name=${q}&limit=1&fields=id,name`);
  if (!res.ok) return null;
  const data = (await res.json()) as { orders?: any[] };
  const o = (data.orders ?? [])[0];
  return o ? String(o.id) : null;
}

async function getOpenFulfillmentOrders(
  shop: string,
  token: string,
  version: string,
  orderId: string
): Promise<any[]> {
  const res = await shopifyGet(shop, token, version, `/orders/${orderId}/fulfillment_orders.json`);
  if (!res.ok) return [];
  const data = (await res.json()) as { fulfillment_orders?: any[] };
  return (data.fulfillment_orders ?? []).filter(
    (fo) => fo.status === "open" || fo.status === "in_progress" || fo.status === "scheduled"
  );
}

// Mark an order fulfilled with tracking (AWB + courier) via the Fulfillment Orders API.
export async function fulfillWithTracking(
  shop: string,
  token: string,
  version: string,
  orderId: string,
  awb: string,
  courier: string,
  notifyCustomer = false
): Promise<{ ok: boolean; msg: string }> {
  const fos = await getOpenFulfillmentOrders(shop, token, version, orderId);
  if (!fos.length) return { ok: false, msg: "no open fulfillment orders (already fulfilled?)" };
  const body = {
    fulfillment: {
      line_items_by_fulfillment_order: fos.map((fo) => ({ fulfillment_order_id: fo.id })),
      tracking_info: { number: awb, company: courier || undefined },
      notify_customer: notifyCustomer,
    },
  };
  const res = await shopifyPost(shop, token, version, `/fulfillments.json`, body);
  if (res.ok) return { ok: true, msg: "fulfilled" };
  const t = await res.text();
  return { ok: false, msg: `HTTP ${res.status}: ${t.slice(0, 160)}` };
}
