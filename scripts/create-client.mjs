// Generate the SQL to create a client login (PBKDF2 hashed password).
// Usage:  node scripts/create-client.mjs "email@example.com" "TheirPassword" "Client Name"
// Then run the printed line, e.g.:
//   npx wrangler d1 execute shipxpeed_connect --remote --command "<SQL>"

const [, , email, password, name = ""] = process.argv;
if (!email || !password) {
  console.error('Usage: node scripts/create-client.mjs "email" "password" "Name"');
  process.exit(1);
}

const enc = new TextEncoder();
function b64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
const hash = `pbkdf2$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;

const sql = `INSERT INTO clients (email, name, password_hash) VALUES ('${email.replace(/'/g, "''")}', '${name.replace(/'/g, "''")}', '${hash}');`;

console.log("\n--- Run this to create the client ---\n");
console.log(`npx wrangler d1 execute shipxpeed_connect --remote --command "${sql}"`);
console.log("\n(or paste the SQL into the Cloudflare dashboard → D1 → your database → Console)\n");
