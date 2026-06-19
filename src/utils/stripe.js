// Node equivalent of emergentintegrations.payments.stripe.checkout
// Provides StripeCheckout with create_checkout_session / get_checkout_status /
// handle_webhook semantics used by server.py.
let Stripe = null;
let STRIPE_AVAILABLE = false;
try {
  Stripe = require("stripe");
  STRIPE_AVAILABLE = true;
} catch (e) {
  STRIPE_AVAILABLE = false;
}

class StripeCheckout {
  constructor({ apiKey, webhookUrl }) {
    this.apiKey = apiKey;
    this.webhookUrl = webhookUrl;
    this.client = Stripe(apiKey);
  }

  async createCheckoutSession({ amount, currency, successUrl, cancelUrl, metadata }) {
    const session = await this.client.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: "Payment" },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: metadata || {},
    });
    return { session_id: session.id, url: session.url };
  }

  async getCheckoutStatus(sessionId) {
    const s = await this.client.checkout.sessions.retrieve(sessionId);
    return {
      status: s.status,
      payment_status: s.payment_status,
      amount_total: s.amount_total,
      currency: s.currency,
    };
  }

  async handleWebhook(body, sig) {
    // Without a configured signing secret we parse the event payload directly,
    // matching the lenient behaviour relied upon by server.py.
    const evt = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf-8") : String(body));
    const obj = (evt.data && evt.data.object) || {};
    return {
      session_id: obj.id,
      payment_status: obj.payment_status,
      event_type: evt.type,
    };
  }
}

module.exports = { Stripe, STRIPE_AVAILABLE, StripeCheckout };
