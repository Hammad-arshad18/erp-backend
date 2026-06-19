const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, docOut, oid, isoNow, encryptSecret, decryptSecret,
} = require("../utils/helpers");
const { PLAN_MODULES, PLANS, CURRENCIES, currencySymbolFor } = require("../utils/constants");
const { STRIPE_AVAILABLE, StripeCheckout } = require("../utils/stripe");
const { authenticate, requireAdmin, requireSuperAdmin } = require("../middlewares/auth");

const STORE_CREATE_FIELDS = [
  { name: "name", type: "str", required: true },
  { name: "address", type: "str" },
  { name: "phone", type: "str" },
  { name: "email", type: "str" },
  { name: "tax_id", type: "str" },
  { name: "receipt_footer", type: "str" },
  { name: "logo_url", type: "str" },
  { name: "is_default", type: "bool", default: false },
  { name: "currency", type: "str", default: "USD" },
  { name: "plan", type: "str", default: "enterprise" },
];

const STORE_UPDATE_FIELDS = [
  { name: "name", type: "str" },
  { name: "address", type: "str" },
  { name: "phone", type: "str" },
  { name: "email", type: "str" },
  { name: "tax_id", type: "str" },
  { name: "receipt_footer", type: "str" },
  { name: "logo_url", type: "str" },
  { name: "is_default", type: "bool" },
  { name: "currency", type: "str" },
  { name: "plan", type: "str" },
  { name: "modules_override", type: "list" },
  { name: "stripe_api_key", type: "str" },
];

const SETTINGS_FIELDS = [
  { name: "name", type: "str" },
  { name: "address", type: "str" },
  { name: "phone", type: "str" },
  { name: "email", type: "str" },
  { name: "tax_id", type: "str" },
  { name: "receipt_footer", type: "str" },
  { name: "logo_url", type: "str" },
  { name: "stripe_api_key", type: "str" },
];

function maskStripe(out) {
  if (out.stripe_api_key) {
    try {
      const plain = decryptSecret(out.stripe_api_key);
      out.stripe_api_key_masked = `${plain.slice(0, 7)}...${plain.slice(-4)}`;
    } catch (e) {
      out.stripe_api_key_masked = "(unreadable)";
    }
  }
  delete out.stripe_api_key;
  return out;
}

module.exports = (api) => {
  api.get("/stores", authenticate, asyncHandler(async (req, res) => {
    let docs;
    if (req.user.role === "super_admin") {
      docs = await db.collection("stores").find({}).sort({ created_at: 1 }).limit(200).toArray();
    } else {
      const sid = req.user.store_id;
      if (!sid) return res.json([]);
      docs = await db.collection("stores").find({ _id: oid(sid) }).limit(1).toArray();
    }
    res.json(docs.map(docOut));
  }));

  api.post("/stores", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
    const doc = validate(req.body, STORE_CREATE_FIELDS);
    if (!(doc.plan in PLAN_MODULES)) throw new HttpError(400, "Invalid plan");
    doc.currency_symbol = currencySymbolFor(doc.currency);
    doc.modules_override = null;
    doc.created_at = isoNow();
    if (doc.is_default) {
      await db.collection("stores").updateMany({}, { $set: { is_default: false } });
    }
    const result = await db.collection("stores").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.patch("/stores/:sid", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
    const update = validate(req.body, STORE_UPDATE_FIELDS, { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    if (update.plan && !(update.plan in PLAN_MODULES)) throw new HttpError(400, "Invalid plan");
    if (update.is_default) {
      await db.collection("stores").updateMany({}, { $set: { is_default: false } });
    }
    if ("currency" in update) {
      update.currency_symbol = currencySymbolFor(update.currency);
    }
    const result = await db.collection("stores").updateOne({ _id: oid(req.params.sid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Store not found");
    const doc = await db.collection("stores").findOne({ _id: oid(req.params.sid) });
    res.json(docOut(doc));
  }));

  api.delete("/stores/:sid", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
    const inUse = await db.collection("products").countDocuments({ store_id: req.params.sid });
    if (inUse) throw new HttpError(400, `Cannot delete: ${inUse} products linked to this store`);
    const result = await db.collection("stores").deleteOne({ _id: oid(req.params.sid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Store not found");
    res.json({ ok: true });
  }));

  api.get("/plans", authenticate, asyncHandler(async (req, res) => {
    res.json(PLANS);
  }));

  api.get("/currencies", authenticate, asyncHandler(async (req, res) => {
    res.json(CURRENCIES);
  }));

  // ---- Store self-settings ----
  api.get("/settings/store", authenticate, asyncHandler(async (req, res) => {
    if (req.user.role === "super_admin") throw new HttpError(400, "Super admin manages stores via /api/stores");
    const sid = req.user.store_id;
    if (!sid) throw new HttpError(404, "No store assigned");
    const store = await db.collection("stores").findOne({ _id: oid(sid) });
    if (!store) throw new HttpError(404, "Store not found");
    res.json(maskStripe(docOut(store)));
  }));

  api.patch("/settings/store", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    if (req.user.role === "super_admin") throw new HttpError(400, "Super admin manages stores via /api/stores");
    const sid = req.user.store_id;
    if (!sid) throw new HttpError(404, "No store assigned");
    const update = validate(req.body, SETTINGS_FIELDS, { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    if ("stripe_api_key" in update) {
      const k = update.stripe_api_key;
      if (k === "" || k === "__remove__") {
        update.stripe_api_key = null;
      } else if (!(k.startsWith("sk_test_") || k.startsWith("sk_live_") || k.startsWith("rk_"))) {
        throw new HttpError(400, "Invalid Stripe key format (expected sk_test_ / sk_live_ / rk_)");
      } else {
        update.stripe_api_key = encryptSecret(k);
      }
    }
    await db.collection("stores").updateOne({ _id: oid(sid) }, { $set: update });
    const doc = await db.collection("stores").findOne({ _id: oid(sid) });
    res.json(maskStripe(docOut(doc)));
  }));

  api.post("/settings/store/test-stripe", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    if (!STRIPE_AVAILABLE) throw new HttpError(503, "Stripe library not available");
    const sid = req.user.store_id;
    const store = sid ? await db.collection("stores").findOne({ _id: oid(sid) }) : null;
    const key = (store && store.stripe_api_key) || process.env.STRIPE_API_KEY;
    if (!key) throw new HttpError(400, "No Stripe key configured");
    try {
      const sc = new StripeCheckout({ apiKey: key, webhookUrl: `${process.env.FRONTEND_URL || ""}/api/webhook/stripe` });
      const sess = await sc.createCheckoutSession({
        amount: 1.0,
        currency: "usd",
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
        metadata: { source: "key_test" },
      });
      res.json({ ok: true, test_session: sess.session_id.slice(0, 24) + "..." });
    } catch (e) {
      throw new HttpError(400, `Key test failed: ${String(e.message || e)}`);
    }
  }));
};
