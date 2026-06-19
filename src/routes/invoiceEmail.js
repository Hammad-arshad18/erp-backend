const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, oid, isoNow,
} = require("../utils/helpers");
const { STRIPE_AVAILABLE, StripeCheckout } = require("../utils/stripe");
const { buildInvoiceHtml, sendEmail } = require("../utils/email");
const { authenticate } = require("../middlewares/auth");

function baseUrl(req) {
  return `${req.protocol}://${req.get("host")}/`;
}

module.exports = (api) => {
  api.post("/invoices/:iid/email", authenticate, asyncHandler(async (req, res) => {
    const apiKey = process.env.RESEND_API_KEY || "";
    if (!apiKey || apiKey.startsWith("re_placeholder")) {
      throw new HttpError(503, "Email not configured. Add RESEND_API_KEY to backend .env");
    }
    const payload = validate(req.body, [
      { name: "to_email", type: "str", required: true, email: true },
      { name: "include_pay_link", type: "bool", default: false },
      { name: "origin_url", type: "str" },
    ]);
    const iid = req.params.iid;
    const inv = await db.collection("invoices").findOne({ _id: oid(iid) });
    if (!inv) throw new HttpError(404, "Invoice not found");
    let payUrl = null;
    if (payload.include_pay_link && STRIPE_AVAILABLE && process.env.STRIPE_API_KEY) {
      try {
        const origin = payload.origin_url || process.env.FRONTEND_URL || "";
        const successUrl = `${origin}/invoices?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${origin}/invoices`;
        const stripeCheckout = new StripeCheckout({
          apiKey: process.env.STRIPE_API_KEY,
          webhookUrl: `${baseUrl(req)}api/webhook/stripe`,
        });
        const sess = await stripeCheckout.createCheckoutSession({
          amount: parseFloat(inv.total),
          currency: "usd",
          successUrl,
          cancelUrl,
          metadata: { invoice_id: String(inv._id), invoice_number: inv.invoice_number || "", source: "email_pay_link" },
        });
        payUrl = sess.url;
        await db.collection("payment_transactions").insertOne({
          session_id: sess.session_id,
          invoice_id: String(inv._id),
          invoice_number: inv.invoice_number,
          amount: parseFloat(inv.total),
          currency: "usd",
          status: "initiated",
          payment_status: "unpaid",
          metadata: { invoice_id: String(inv._id), source: "email_pay_link" },
          created_at: isoNow(),
        });
      } catch (e) {
        console.warn(`Pay link creation failed: ${e}`);
      }
    }

    const sender = process.env.SENDER_EMAIL || "onboarding@resend.dev";
    const html = buildInvoiceHtml(inv, payUrl);
    const params = {
      from: sender,
      to: [payload.to_email],
      subject: `Your FreshMarket receipt ${inv.invoice_number || ""}`,
      html,
    };
    try {
      const email = await sendEmail(apiKey, params);
      await db.collection("invoices").updateOne(
        { _id: oid(iid) },
        { $set: { emailed_to: payload.to_email, emailed_at: isoNow() } }
      );
      res.json({ ok: true, email_id: (email || {}).id, pay_url: payUrl });
    } catch (e) {
      console.error(`Resend send failed: ${e}`);
      throw new HttpError(502, `Email send failed: ${String(e.message || e)}`);
    }
  }));
};
