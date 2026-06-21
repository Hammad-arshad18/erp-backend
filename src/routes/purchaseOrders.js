const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, stampStore, docOut, oid, isoNow, round2, logMovement,
} = require("../utils/helpers");
const { authenticate, requireAdmin } = require("../middlewares/auth");

function utcCompactToday() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function nextPoNumber() {
  const today = utcCompactToday();
  const count = await db.collection("purchase_orders").countDocuments({ po_number: { $regex: `^PO-${today}-` } });
  return `PO-${today}-${String(count + 1).padStart(4, "0")}`;
}

module.exports = (api) => {
  api.get("/purchase-orders", authenticate, asyncHandler(async (req, res) => {
    const docs = await db.collection("purchase_orders").find(scopeQuery(req.user)).sort({ created_at: -1 }).limit(500).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/purchase-orders", authenticate, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const head = validate(body, [
      { name: "supplier_id", type: "str", required: true },
      { name: "notes", type: "str" },
      { name: "expected_at", type: "str" },
    ]);
    const rawItems = body.items;
    if (!Array.isArray(rawItems)) {
      throw new HttpError(422, [{ type: "missing", loc: ["body", "items"], msg: "Field required" }]);
    }
    const items = rawItems.map((it) => validate(it, [
      { name: "product_id", type: "str", required: true },
      { name: "name", type: "str", required: true },
      { name: "qty", type: "int", required: true },
      { name: "cost", type: "float", required: true },
    ]));
    if (!items.length) throw new HttpError(400, "PO must have at least one item");
    const sup = await db.collection("suppliers").findOne({ _id: oid(head.supplier_id) });
    if (!sup) throw new HttpError(400, "Supplier not found");
    const total = items.reduce((acc, i) => acc + i.qty * i.cost, 0);
    const itemsOut = items.map((i) => ({
      product_id: i.product_id,
      name: i.name,
      qty: i.qty,
      cost: i.cost,
      line_total: round2(i.qty * i.cost),
    }));
    const doc = {
      po_number: await nextPoNumber(),
      supplier_id: head.supplier_id,
      supplier_name: sup.name,
      items: itemsOut,
      total: round2(total),
      status: "ordered",
      notes: head.notes,
      expected_at: head.expected_at,
      received_at: null,
      created_by: req.user.id,
      created_at: isoNow(),
    };
    stampStore(req.user, doc);
    const result = await db.collection("purchase_orders").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.get("/purchase-orders/:pid", authenticate, asyncHandler(async (req, res) => {
    const doc = await db.collection("purchase_orders").findOne({ _id: oid(req.params.pid) });
    if (!doc) throw new HttpError(404, "PO not found");
    res.json(docOut(doc));
  }));

  api.post("/purchase-orders/:pid/receive", authenticate, asyncHandler(async (req, res) => {
    const doc = await db.collection("purchase_orders").findOne({ _id: oid(req.params.pid) });
    if (!doc) throw new HttpError(404, "PO not found");
    if (doc.status === "received") throw new HttpError(400, "PO already received");
    for (const it of doc.items || []) {
      try {
        await db.collection("products").updateOne({ _id: oid(it.product_id) }, { $inc: { stock: it.qty } });
        await logMovement(req.user, it.product_id, it.name || "", it.qty, "po_receive", doc.po_number || "");
      } catch (e) {
        // pass
      }
    }
    await db.collection("purchase_orders").updateOne(
      { _id: oid(req.params.pid) },
      { $set: { status: "received", received_at: isoNow() } }
    );
    res.json({ ok: true });
  }));

  api.delete("/purchase-orders/:pid", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const result = await db.collection("purchase_orders").deleteOne({ _id: oid(req.params.pid) });
    if (result.deletedCount === 0) throw new HttpError(404, "PO not found");
    res.json({ ok: true });
  }));
};
