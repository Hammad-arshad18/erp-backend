const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, docOut, oid, isoNow, round2,
} = require("../utils/helpers");
const { authenticate, requireAdmin } = require("../middlewares/auth");

function utcCompactToday() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function nextInvoiceNumber() {
  const today = utcCompactToday();
  const count = await db.collection("invoices").countDocuments({
    invoice_number: { $regex: `^INV-${today}-` },
  });
  return `INV-${today}-${String(count + 1).padStart(4, "0")}`;
}

module.exports = (api) => {
  api.post("/invoices", authenticate, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const head = validate(body, [
      { name: "customer_id", type: "str" },
      { name: "tax_rate", type: "float", default: 0 },
      { name: "discount", type: "float", default: 0 },
      { name: "payment_method", type: "str", default: "cash" },
      { name: "notes", type: "str" },
    ]);
    const rawItems = body.items;
    if (!Array.isArray(rawItems)) {
      throw new HttpError(422, [{ type: "missing", loc: ["body", "items"], msg: "Field required" }]);
    }
    const items = rawItems.map((it) => validate(it, [
      { name: "product_id", type: "str", required: true },
      { name: "name", type: "str", required: true },
      { name: "sku", type: "str" },
      { name: "qty", type: "int", required: true },
      { name: "price", type: "float", required: true },
    ]));

    if (!items.length) throw new HttpError(400, "Invoice must have at least one item");

    // Validate stock
    for (const it of items) {
      const prod = await db.collection("products").findOne({ _id: oid(it.product_id) });
      if (!prod) throw new HttpError(400, `Product ${it.name} not found`);
      if ((prod.stock || 0) < it.qty) {
        throw new HttpError(400, `Insufficient stock for ${prod.name} (available ${prod.stock || 0})`);
      }
    }

    const subtotal = items.reduce((acc, it) => acc + it.qty * it.price, 0);
    const taxAmount = round2(subtotal * (head.tax_rate / 100.0));
    let total = round2(subtotal + taxAmount - head.discount);
    if (total < 0) total = 0;

    let customerDoc = null;
    if (head.customer_id) {
      customerDoc = await db.collection("customers").findOne({ _id: oid(head.customer_id) });
      if (!customerDoc) throw new HttpError(400, "Customer not found");
    }

    const invoiceNumber = await nextInvoiceNumber();
    const pointsEarned = Math.trunc(total);

    const itemsOut = items.map((it) => ({
      product_id: it.product_id,
      name: it.name,
      sku: it.sku,
      qty: it.qty,
      price: it.price,
      line_total: round2(it.qty * it.price),
    }));

    const doc = {
      invoice_number: invoiceNumber,
      customer_id: head.customer_id,
      customer_name: customerDoc ? customerDoc.name : "Walk-in",
      items: itemsOut,
      subtotal: round2(subtotal),
      tax_rate: head.tax_rate,
      tax_amount: taxAmount,
      discount: head.discount,
      total,
      payment_method: head.payment_method,
      notes: head.notes,
      points_earned: pointsEarned,
      status: "paid",
      cashier_id: req.user.id,
      cashier_name: req.user.name,
      created_at: isoNow(),
    };
    const result = await db.collection("invoices").insertOne(doc);

    // Decrement stock + log movement
    const { logMovement } = require("../utils/helpers");
    for (const it of items) {
      await db.collection("products").updateOne({ _id: oid(it.product_id) }, { $inc: { stock: -it.qty } });
      await logMovement(req.user, it.product_id, it.name, -it.qty, "sale", invoiceNumber);
    }

    if (head.customer_id && pointsEarned > 0) {
      await db.collection("customers").updateOne({ _id: oid(head.customer_id) }, { $inc: { loyalty_points: pointsEarned } });
    }

    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.get("/invoices", authenticate, asyncHandler(async (req, res) => {
    const query = scopeQuery(req.user);
    const { q, start, end, customer_id } = req.query;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 200;
    if (q) {
      query.$or = [
        { invoice_number: { $regex: q, $options: "i" } },
        { customer_name: { $regex: q, $options: "i" } },
      ];
    }
    if (customer_id) query.customer_id = customer_id;
    if (start || end) {
      const d = {};
      if (start) d.$gte = start;
      if (end) d.$lte = end;
      query.created_at = d;
    }
    const docs = await db.collection("invoices").find(query).sort({ created_at: -1 }).limit(limit).toArray();
    res.json(docs.map(docOut));
  }));

  api.get("/invoices/:iid", authenticate, asyncHandler(async (req, res) => {
    const doc = await db.collection("invoices").findOne({ _id: oid(req.params.iid) });
    if (!doc) throw new HttpError(404, "Invoice not found");
    res.json(docOut(doc));
  }));

  api.delete("/invoices/:iid", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const doc = await db.collection("invoices").findOne({ _id: oid(req.params.iid) });
    if (!doc) throw new HttpError(404, "Invoice not found");
    // Restock items
    for (const it of doc.items || []) {
      try {
        await db.collection("products").updateOne({ _id: oid(it.product_id) }, { $inc: { stock: it.qty } });
      } catch (e) {
        // pass
      }
    }
    // Reverse loyalty points
    if (doc.customer_id && doc.points_earned) {
      try {
        await db.collection("customers").updateOne({ _id: oid(doc.customer_id) }, { $inc: { loyalty_points: -doc.points_earned } });
      } catch (e) {
        // pass
      }
    }
    await db.collection("invoices").deleteOne({ _id: oid(req.params.iid) });
    res.json({ ok: true });
  }));
};
