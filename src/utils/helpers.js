const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");
const { db } = require("./db");

const JWT_ALGORITHM = "HS256";

// ---- Error type mirroring FastAPI's HTTPException ----
// detail can be a string (normal errors) or an array/object (validation errors),
// matching FastAPI's `{"detail": ...}` response body shape.
class HttpError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : "error");
    this.status = status;
    this.detail = detail;
  }
}

// Wrap async route handlers so thrown errors / rejected promises reach the
// central error middleware.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---- Time helpers: produce Python datetime.isoformat()-compatible strings ----
// Python: datetime.now(timezone.utc).isoformat() -> "2026-06-18T17:35:00.123456+00:00"
function isoNow() {
  // JS gives 3 fractional digits + "Z". Convert to 6 digits + "+00:00".
  return new Date().toISOString().replace("Z", "000+00:00");
}

// Python: datetime.now(timezone.utc).date().isoformat() -> "YYYY-MM-DD"
function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Password helpers ----
function hashPassword(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync());
}

function verifyPassword(plain, hashed) {
  try {
    return bcrypt.compareSync(plain, hashed);
  } catch (e) {
    return false;
  }
}

// ---- JWT helpers ----
function getJwtSecret() {
  return process.env.JWT_SECRET;
}

function createAccessToken(userId, email) {
  return jwt.sign(
    { sub: userId, email, type: "access" },
    getJwtSecret(),
    { algorithm: JWT_ALGORITHM, expiresIn: "8h" }
  );
}

function createRefreshToken(userId) {
  return jwt.sign(
    { sub: userId, type: "refresh" },
    getJwtSecret(),
    { algorithm: JWT_ALGORITHM, expiresIn: "7d" }
  );
}

function setAuthCookies(res, accessToken, refreshToken) {
  // secure=True + samesite=none required for cross-site preview cookies
  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 60 * 60 * 8 * 1000,
    path: "/",
  });
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 60 * 60 * 24 * 7 * 1000,
    path: "/",
  });
}

// ---- ObjectId / serialization ----
function oid(s) {
  try {
    return new ObjectId(s);
  } catch (e) {
    throw new HttpError(400, "Invalid id");
  }
}

function docOut(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  if ("_id" in out) {
    out.id = String(out._id);
    delete out._id;
  }
  delete out.password_hash;
  return out;
}

// ---- Scoping ----
function scopeQuery(user, query) {
  const q = { ...(query || {}) };
  if (user && user.role === "super_admin") {
    return q;
  }
  const sid = user ? user.store_id : null;
  if (sid) {
    q.store_id = sid;
  } else {
    q.store_id = "__NONE__";
  }
  return q;
}

function stampStore(user, doc) {
  if (user && user.role !== "super_admin" && user.store_id) {
    doc.store_id = user.store_id;
  }
  return doc;
}

// ---- AES-GCM for secrets ----
function encKey() {
  const raw = process.env.ENCRYPTION_KEY || "";
  return crypto.createHash("sha256").update(raw, "utf-8").digest();
}

function encryptSecret(plain) {
  if (!plain) return "";
  const key = encKey();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Python AESGCM returns ciphertext || tag
  const blob = Buffer.concat([nonce, ct, tag]);
  return "v1:" + blob.toString("base64");
}

function decryptSecret(blob) {
  if (!blob) return "";
  if (!blob.startsWith("v1:")) return blob; // legacy plaintext
  const raw = Buffer.from(blob.slice(3), "base64");
  const nonce = raw.subarray(0, 12);
  const rest = raw.subarray(12);
  const tag = rest.subarray(rest.length - 16);
  const ct = rest.subarray(0, rest.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), nonce);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString("utf-8");
}

// ---- Inventory movement logger ----
async function logMovement(user, productId, name, qty, moveType, reference = "", notes = null) {
  try {
    const doc = {
      product_id: productId,
      product_name: name,
      qty: parseInt(qty, 10),
      type: moveType,
      reference,
      notes,
      user_id: user ? user.id : null,
      user_name: user ? user.name : null,
      created_at: isoNow(),
    };
    if (user) stampStore(user, doc);
    await db.collection("inventory_movements").insertOne(doc);
  } catch (e) {
    console.warn(`movement log fail: ${e}`);
  }
}

// ---- Permissions ----
function hasPerm(user, perm) {
  if (user && user.role === "admin") return true;
  const perms = (user && user.permissions) || [];
  return perms.includes(perm);
}

// ---- Numeric helpers (Python round(x, 2)) ----
function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function round(x, ndigits) {
  const f = Math.pow(10, ndigits);
  return Math.round((x + Number.EPSILON) * f) / f;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isEmail(v) {
  return EMAIL_RE.test(String(v));
}

// ---- Lightweight body validation mirroring Pydantic models ----
// fields: array of { name, type, required, default, email }
// type: 'str' | 'int' | 'float' | 'bool' | 'list' | 'any'
// When partial=true (Update models), only provided non-null fields are returned,
// matching `{k: v for k, v in payload.model_dump().items() if v is not None}`.
function validate(body, fields, { partial = false } = {}) {
  const src = body || {};
  const errors = [];
  const out = {};
  for (const f of fields) {
    const name = f.name;
    let v = src[name];
    const provided = v !== undefined && v !== null;
    if (!provided) {
      if (partial) continue;
      if (f.required) {
        errors.push({ type: "missing", loc: ["body", name], msg: "Field required" });
        continue;
      }
      out[name] = f.default !== undefined ? f.default : null;
      continue;
    }
    const type = f.type || "any";
    if (type === "int") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors.push({ type: "int_parsing", loc: ["body", name], msg: "Input should be a valid integer" });
        continue;
      }
      v = Math.trunc(n);
    } else if (type === "float") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors.push({ type: "float_parsing", loc: ["body", name], msg: "Input should be a valid number" });
        continue;
      }
      v = n;
    } else if (type === "bool") {
      v = v === true || v === "true" || v === 1 || v === "1";
    } else if (type === "str") {
      v = String(v);
    } else if (type === "list") {
      if (!Array.isArray(v)) {
        errors.push({ type: "list_type", loc: ["body", name], msg: "Input should be a valid list" });
        continue;
      }
    }
    if (f.email && !isEmail(v)) {
      errors.push({ type: "value_error", loc: ["body", name], msg: "value is not a valid email address" });
      continue;
    }
    out[name] = v;
  }
  if (errors.length) throw new HttpError(422, errors);
  return out;
}

module.exports = {
  JWT_ALGORITHM,
  HttpError,
  asyncHandler,
  isoNow,
  isoDateToday,
  hashPassword,
  verifyPassword,
  getJwtSecret,
  createAccessToken,
  createRefreshToken,
  setAuthCookies,
  oid,
  docOut,
  scopeQuery,
  stampStore,
  encryptSecret,
  decryptSecret,
  logMovement,
  hasPerm,
  round2,
  round,
  isEmail,
  validate,
};
