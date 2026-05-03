import { existsSync, readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const serviceAccount = loadGoogleServiceAccount();
const email = cleanGoogleEmail(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) || serviceAccount?.client_email || "";
const privateKey = (cleanGooglePrivateKey(process.env.GOOGLE_PRIVATE_KEY) || serviceAccount?.private_key || "").replaceAll("\\n", "\n");
const sheetId = process.env.GOOGLE_SHEET_ID || "";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}

function loadGoogleServiceAccount() {
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? path.resolve(__dirname, "..", process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : path.join(__dirname, "google-service-account.json");
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function cleanGoogleEmail(value = "") {
  if (!value || value.includes("service-account-name@project-id")) return "";
  return value;
}

function cleanGooglePrivateKey(value = "") {
  if (!value || value.includes("...")) return "";
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || result.error || "Token error");
  return result.access_token;
}

async function googleFetch(url) {
  const token = await getGoogleAccessToken();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || JSON.stringify(result));
  return result;
}

console.log("Google config check");
console.log("-------------------");
console.log("JSON file:", serviceAccount ? "OK" : "NOT FOUND");
console.log("Service email:", email || "EMPTY");
console.log("Private key:", privateKey ? "OK" : "EMPTY");
console.log("Sheet ID:", sheetId || "EMPTY");

if (!email || !privateKey) {
  console.log("\nMissing service account credentials.");
  process.exit(1);
}

try {
  await getGoogleAccessToken();
  console.log("Access token: OK");
} catch (error) {
  console.log("Access token: ERROR");
  console.log(error.message);
  process.exit(1);
}

if (sheetId) {
  try {
    const result = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title`);
    console.log("Sheet access: OK");
    console.log("Sheet title:", result.properties?.title);
  } catch (error) {
    console.log("Sheet access: ERROR");
    console.log(error.message);
  }
}
