const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, docOut, oid, isoNow, decryptSecret,
} = require("../utils/helpers");
const { STRIPE_AVAILABLE, StripeCheckout } = require("../utils/stripe");
const { authenticate } = require("../middlewares/auth");

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}/`;
}

module.exports = (api) => {
  api.post("/invoices/:iid/stripe-session", authenticate, asyncHandler(async (req, res) => {
    if (!STRIPE_AVAILABLE) throw new HttpError(503, "Stripe library not available");
    const inv = await db.collection("invoices").findOne({ _id: oid(req.params.iid) });
    if (!inv) throw new HttpError(404, "Invoice not found");
    const sid = inv.store_id || req.user.store_id;
    let apiKey = null;
    let usedAccount = "platform";
    if (sid) {
      const store = await db.collection("stores").findOne({ _id: oid(sid) });
      if (store && store.stripe_api_key) {
        apiKey = store.stripe_api_key;
        usedAccount = "store";
      }
    }
    if (!apiKey) apiKey = process.env.STRIPE_API_KEY;
    if (!apiKey) throw new HttpError(503, "Stripe not configured");

    const body = req.body || {};
    const origin = body.origin_url || process.env.FRONTEND_URL || "";
    if (!origin) throw new HttpError(400, "Missing origin_url");

    const successUrl = `${origin}/invoices?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/invoices`;

    const webhookUrl = `${baseUrl(req)}api/webhook/stripe`;
    const stripeCheckout = new StripeCheckout({ apiKey, webhookUrl });

    const amount = parseFloat(inv.total);
    if (amount <= 0) throw new HttpError(400, "Invoice total must be > 0");

    const metadata = {
      invoice_id: String(inv._id),
      invoice_number: inv.invoice_number || "",
      customer_id: inv.customer_id || "",
      source: "supermarket_crm_pos",
      stripe_account: usedAccount,
    };
    const session = await stripeCheckout.createCheckoutSession({
      amount,
      currency: "usd",
      successUrl,
      cancelUrl,
      metadata,
    });
    await db.collection("payment_transactions").insertOne({
      session_id: session.session_id,
      invoice_id: String(inv._id),
      invoice_number: inv.invoice_number,
      amount,
      currency: "usd",
      status: "initiated",
      payment_status: "unpaid",
      stripe_account_type: usedAccount,
      store_id: sid,
      metadata,
      created_at: isoNow(),
    });
    res.json({ url: session.url, session_id: session.session_id, stripe_account: usedAccount });
  }));

  api.get("/payments/checkout/status/:session_id", authenticate, asyncHandler(async (req, res) => {
    if (!STRIPE_AVAILABLE) throw new HttpError(503, "Stripe not available");
    const sessionId = req.params.session_id;
    let txn = await db.collection("payment_transactions").findOne({ session_id: sessionId });
    let apiKey = null;
    if (txn && txn.store_id) {
      const store = await db.collection("stores").findOne({ _id: oid(txn.store_id) });
      if (store && store.stripe_api_key) {
        try {
          apiKey = decryptSecret(store.stripe_api_key);
        } catch (e) {
          apiKey = null;
        }
      }
    }
    if (!apiKey) apiKey = process.env.STRIPE_API_KEY;
    const webhookUrl = `${baseUrl(req)}api/webhook/stripe`;
    const stripeCheckout = new StripeCheckout({ apiKey, webhookUrl });
    const status = await stripeCheckout.getCheckoutStatus(sessionId);
    txn = await db.collection("payment_transactions").findOne({ session_id: sessionId });
    if (txn && txn.payment_status !== "paid" && status.payment_status === "paid") {
      await db.collection("payment_transactions").updateOne(
        { session_id: sessionId },
        { $set: { status: status.status, payment_status: status.payment_status, paid_at: isoNow() } }
      );
      const invId = (txn.metadata && txn.metadata.invoice_id) || txn.invoice_id;
      if (invId) {
        try {
          await db.collection("invoices").updateOne(
            { _id: oid(invId) },
            { $set: { payment_method: "stripe", payment_status: "paid", stripe_paid_at: isoNow() } }
          );
        } catch (e) {
          // pass
        }
      }
    } else if (txn && status.status !== txn.status) {
      await db.collection("payment_transactions").updateOne(
        { session_id: sessionId },
        { $set: { status: status.status, payment_status: status.payment_status } }
      );
    }
    res.json({
      status: status.status,
      payment_status: status.payment_status,
      amount_total: status.amount_total,
      currency: status.currency,
    });
  }));

  api.post("/webhook/stripe", asyncHandler(async (req, res) => {
    if (!STRIPE_AVAILABLE) return res.json({ ok: false });
    const apiKey = process.env.STRIPE_API_KEY;
    const webhookUrl = `${baseUrl(req)}api/webhook/stripe`;
    const stripeCheckout = new StripeCheckout({ apiKey, webhookUrl });
    const body = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const sig = req.headers["stripe-signature"] || "";
    let evt;
    try {
      evt = await stripeCheckout.handleWebhook(body, sig);
    } catch (e) {
      console.error(`Webhook error: ${e}`);
      return res.json({ ok: false });
    }
    if (evt.payment_status === "paid") {
      const txn = await db.collection("payment_transactions").findOne({ session_id: evt.session_id });
      if (txn && txn.payment_status !== "paid") {
        await db.collection("payment_transactions").updateOne(
          { session_id: evt.session_id },
          { $set: { payment_status: "paid", status: "complete", paid_at: isoNow() } }
        );
        const invId = (txn.metadata && txn.metadata.invoice_id) || txn.invoice_id;
        if (invId) {
          try {
            await db.collection("invoices").updateOne(
              { _id: oid(invId) },
              { $set: { payment_method: "stripe", payment_status: "paid", stripe_paid_at: isoNow() } }
            );
          } catch (e) {
            // pass
          }
        }
      }
    }
    res.json({ ok: true });
  }));

  api.post("/invoices/:iid/payments", authenticate, asyncHandler(async (req, res) => {
    const payload = validate(req.body, [
      { name: "method", type: "str", required: true },
      { name: "amount", type: "float", required: true },
      { name: "reference", type: "str" },
      { name: "notes", type: "str" },
    ]);
    const iid = req.params.iid;
    const inv = await db.collection("invoices").findOne({ _id: oid(iid) });
    if (!inv) throw new HttpError(404, "Invoice not found");
    const doc = {
      invoice_id: iid,
      invoice_number: inv.invoice_number,
      customer_name: inv.customer_name,
      method: payload.method,
      amount: parseFloat(payload.amount),
      reference: payload.reference,
      notes: payload.notes,
      recorded_by: req.user.id,
      recorded_by_name: req.user.name,
      created_at: isoNow(),
    };
    const { stampStore } = require("../utils/helpers");
    stampStore(req.user, doc);
    const result = await db.collection("manual_payments").insertOne(doc);
    await db.collection("invoices").updateOne(
      { _id: oid(iid) },
      { $set: { payment_method: payload.method, payment_status: "paid", manually_paid_at: doc.created_at } }
    );
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.get("/payments/history", authenticate, asyncHandler(async (req, res) => {
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 300;
    const scope = scopeQuery(req.user);
    const manual = await db.collection("manual_payments").find(scope).sort({ created_at: -1 }).limit(limit).toArray();
    const stripeTxns = await db.collection("payment_transactions").find(scope).sort({ created_at: -1 }).limit(limit).toArray();
    const out = [];
    for (const m of manual) {
      const d = docOut(m);
      d.source = "manual";
      out.push(d);
    }
    for (const t of stripeTxns) {
      const d = docOut(t);
      d.source = "stripe";
      if (d.method === undefined) d.method = "stripe";
      out.push(d);
    }
    out.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    res.json(out.slice(0, limit));
  }));
};
