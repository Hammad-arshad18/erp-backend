const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, stampStore, docOut, oid, isoNow, round2, logMovement,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

function utcCompactToday() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

module.exports = (api) => {
  api.post("/returns", authenticate, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const head = validate(body, [
      { name: "invoice_id", type: "str", required: true },
      { name: "reason", type: "str" },
      { name: "refund_method", type: "str", default: "cash" },
    ]);
    const rawItems = body.items;
    if (!Array.isArray(rawItems)) {
      throw new HttpError(422, [{ type: "missing", loc: ["body", "items"], msg: "Field required" }]);
    }
    const items = rawItems.map((it) => validate(it, [
      { name: "product_id", type: "str", required: true },
      { name: "name", type: "str", required: true },
      { name: "qty", type: "int", required: true },
      { name: "price", type: "float", required: true },
    ]));

    const inv = await db.collection("invoices").findOne({ _id: oid(head.invoice_id) });
    if (!inv) throw new HttpError(404, "Invoice not found");
    if (!items.length) throw new HttpError(400, "Pick at least one item to return");
    const today = utcCompactToday();
    const count = await db.collection("returns").countDocuments({ return_number: { $regex: `^RET-${today}-` } });
    const refundAmount = round2(items.reduce((acc, i) => acc + i.qty * i.price, 0));
    const doc = {
      return_number: `RET-${today}-${String(count + 1).padStart(4, "0")}`,
      invoice_id: head.invoice_id,
      invoice_number: inv.invoice_number,
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      items: items.map((it) => ({ ...it })),
      reason: head.reason,
      refund_amount: refundAmount,
      refund_method: head.refund_method,
      cashier_id: req.user.id,
      cashier_name: req.user.name,
      created_at: isoNow(),
    };
    stampStore(req.user, doc);
    const result = await db.collection("returns").insertOne(doc);
    // Restock + log
    for (const it of items) {
      try {
        await db.collection("products").updateOne({ _id: oid(it.product_id) }, { $inc: { stock: it.qty } });
        await logMovement(req.user, it.product_id, it.name, it.qty, "return", doc.return_number, head.reason);
      } catch (e) {
        // pass
      }
    }
    // Reverse loyalty points proportionally
    if (inv.customer_id && (inv.total || 0) > 0) {
      const loyaltyReversal = Math.trunc(refundAmount * ((inv.points_earned || 0) / Math.max(inv.total, 1)));
      if (loyaltyReversal > 0) {
        try {
          await db.collection("customers").updateOne({ _id: oid(inv.customer_id) }, { $inc: { loyalty_points: -loyaltyReversal } });
        } catch (e) {
          // pass
        }
      }
    }
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.get("/returns", authenticate, asyncHandler(async (req, res) => {
    const docs = await db.collection("returns").find(scopeQuery(req.user)).sort({ created_at: -1 }).limit(500).toArray();
    res.json(docs.map(docOut));
  }));

  api.get("/returns/:rid", authenticate, asyncHandler(async (req, res) => {
    const doc = await db.collection("returns").findOne({ _id: oid(req.params.rid) });
    if (!doc) throw new HttpError(404, "Return not found");
    res.json(docOut(doc));
  }));
};
