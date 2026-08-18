// Shipxpeed Bulk B2C export — maps Shopify orders to the exact template.
// Column order & headers MUST match bulkb2ctemplate exactly.

export const SHIPXPEED_HEADER = [
  "Order Reference",
  "Customer*",
  "Customer Phone*",
  "Customer Email",
  "Address Line 1*",
  "Address Line 2",
  "City*",
  "State*",
  "Pincode*",
  "Return Address Name",
  "Warehouse Name*",
  "Auto Pickup*",
  "Weight(in kgs)",
  "Length*",
  "Width*",
  "Height*",
  "Payment Mode*",
  "Service Type",
  "Courier",
  "Item SKU",
  "Item Name*",
  "Item Quantity*",
  "Item Price*",
  "Item Category",
  "Item Tax",
];

export interface ManualInput {
  warehouse: string;
  serviceType: string; // "Surface" | "Air"
  weight: string;
  length: string;
  width: string;
  height: string;
  autoPickup?: string; // optional; blank per current logic
}

// Shopify province_code -> full state name (fallback; API usually gives full name already)
const IN_STATES: Record<string, string> = {
  AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh",
  AS: "Assam", BR: "Bihar", CH: "Chandigarh", CT: "Chhattisgarh", CG: "Chhattisgarh",
  DN: "Dadra and Nagar Haveli and Daman and Diu", DD: "Daman and Diu", DH: "Dadra and Nagar Haveli and Daman and Diu",
  DL: "Delhi", GA: "Goa", GJ: "Gujarat", HR: "Haryana", HP: "Himachal Pradesh",
  JK: "Jammu and Kashmir", JH: "Jharkhand", KA: "Karnataka", KL: "Kerala", LA: "Ladakh",
  LD: "Lakshadweep", MP: "Madhya Pradesh", MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya",
  MZ: "Mizoram", NL: "Nagaland", OR: "Odisha", OD: "Odisha", PY: "Puducherry", PB: "Punjab",
  RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu", TS: "Telangana", TG: "Telangana",
  TR: "Tripura", UP: "Uttar Pradesh", UT: "Uttarakhand", UK: "Uttarakhand", WB: "West Bengal",
};

function stateName(addr: any): string {
  if (!addr) return "";
  const p = (addr.province || "").toString().trim();
  const c = (addr.province_code || "").toString().trim().toUpperCase();
  if (p && p.length > 2) return p;            // already a full name
  if (c && IN_STATES[c]) return IN_STATES[c];
  if (p && IN_STATES[p.toUpperCase()]) return IN_STATES[p.toUpperCase()];
  return p || c;
}

function cleanPhone(...vals: any[]): string {
  for (const v of vals) {
    if (!v) continue;
    const digits = String(v).replace(/\D/g, "");
    if (digits) return digits.slice(-10);
  }
  return "";
}

function fullName(addr: any): string {
  if (!addr) return "";
  if (addr.name) return String(addr.name).trim();
  return `${addr.first_name ?? ""} ${addr.last_name ?? ""}`.trim();
}

function paymentMode(o: any): string {
  const gw = (o.payment_gateway_names ?? []).join(" ").toLowerCase();
  if (gw.includes("cod") || gw.includes("cash on delivery")) return "COD";
  if (!gw && o.financial_status === "pending") return "COD";
  return "Prepaid";
}

function pick(...vals: any[]): string {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  return "";
}

// Build the full grid (array of rows, each row = 25 cells). One row per line item.
export function buildShipxpeedRows(orders: any[], m: ManualInput): string[][] {
  const rows: string[][] = [];
  for (const o of orders) {
    const ship = o.shipping_address ?? null;
    const bill = o.billing_address ?? null;
    const items = (o.line_items ?? []).length ? o.line_items : [{}];

    items.forEach((li: any, j: number) => {
      const row = new Array(25).fill("");
      // item fields — every row
      row[19] = pick(li.sku);
      row[20] = pick(li.title, li.name);
      row[21] = String(li.quantity || 1);
      // Item Price: first row = order Total (current mapping), else line item price
      row[22] = j === 0 ? pick(o.total_price, li.price) : pick(li.price);

      if (j === 0) {
        // order-level fields — first row of each order only
        row[0] = pick(o.name);                                   // Order Reference
        row[1] = pick(fullName(ship), fullName(bill), o.name);   // Customer
        row[2] = cleanPhone(ship?.phone, o.phone, bill?.phone);  // Customer Phone
        row[3] = pick(o.email);                                   // Customer Email
        row[4] = pick(ship?.address1, bill?.address1);           // Address Line 1
        row[5] = pick(ship?.address2, bill?.address2);           // Address Line 2
        row[6] = pick(ship?.city, bill?.city);                   // City
        row[7] = stateName(ship) || stateName(bill);             // State
        row[8] = pick(ship?.zip, bill?.zip);                     // Pincode
        row[9] = "";                                             // Return Address Name (blank)
        row[10] = m.warehouse;                                   // Warehouse Name
        row[11] = m.autoPickup ?? "";                            // Auto Pickup (blank per logic)
        row[12] = m.weight;                                      // Weight
        row[13] = m.length;                                      // Length
        row[14] = m.width;                                       // Width
        row[15] = m.height;                                      // Height
        row[16] = paymentMode(o);                               // Payment Mode
        row[17] = m.serviceType || "Surface";                   // Service Type
        row[18] = "";                                            // Courier (blank)
      }
      rows.push(row);
    });
  }
  return rows;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildShipxpeedCsv(orders: any[], m: ManualInput): string {
  const rows = buildShipxpeedRows(orders, m);
  const out = [SHIPXPEED_HEADER.map(csvCell).join(",")];
  for (const r of rows) out.push(r.map(csvCell).join(","));
  return out.join("\r\n");
}
