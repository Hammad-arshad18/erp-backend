const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, stampStore, docOut, oid, isoNow, logMovement,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

const CREATE_FIELDS = [
  { name: "name", type: "str", required: true },
  { name: "sku", type: "str" },
  { name: "category", type: "str", required: true },
  { name: "price", type: "float", required: true },
  { name: "cost", type: "float", default: 0 },
  { name: "stock", type: "int", default: 0 },
  { name: "reorder_level", type: "int", default: 10 },
  { name: "unit", type: "str", default: "ea" },
  { name: "barcode", type: "str" },
  { name: "image_url", type: "str" },
  { name: "store_id", type: "str" },
];

const UPDATE_FIELDS = [
  { name: "name", type: "str" },
  { name: "sku", type: "str" },
  { name: "category", type: "str" },
  { name: "price", type: "float" },
  { name: "cost", type: "float" },
  { name: "stock", type: "int" },
  { name: "reorder_level", type: "int" },
  { name: "unit", type: "str" },
  { name: "barcode", type: "str" },
  { name: "image_url", type: "str" },
  { name: "store_id", type: "str" },
];

module.exports = (api) => {
  api.get("/products", authenticate, asyncHandler(async (req, res) => {
    const query = scopeQuery(req.user);
    const { q, category, store_id } = req.query;
    const lowStock = req.query.low_stock === "true" || req.query.low_stock === "1";
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { sku: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } },
        { barcode: { $regex: q, $options: "i" } },
      ];
    }
    if (category) query.category = category;
    if (store_id && req.user.role === "super_admin") query.store_id = store_id;
    let docs = await db.collection("products").find(query).sort({ created_at: -1 }).limit(2000).toArray();
    if (lowStock) {
      docs = docs.filter((d) => (d.stock || 0) <= (d.reorder_level !== undefined && d.reorder_level !== null ? d.reorder_level : 10));
    }
    res.json(docs.map(docOut));
  }));

  api.get("/products/categories", authenticate, asyncHandler(async (req, res) => {
    let cats;
    if (req.user.role === "super_admin") {
      cats = await db.collection("products").distinct("category");
    } else {
      cats = await db.collection("products").distinct("category", { store_id: req.user.store_id });
    }
    res.json(cats.filter((c) => c).sort());
  }));

  api.post("/products", authenticate, asyncHandler(async (req, res) => {
    const doc = validate(req.body, CREATE_FIELDS);
    doc.created_at = isoNow();
    stampStore(req.user, doc);
    const result = await db.collection("products").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.patch("/products/:pid", authenticate, asyncHandler(async (req, res) => {
    const update = validate(req.body, UPDATE_FIELDS, { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    const result = await db.collection("products").updateOne({ _id: oid(req.params.pid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Product not found");
    const doc = await db.collection("products").findOne({ _id: oid(req.params.pid) });
    res.json(docOut(doc));
  }));

  api.delete("/products/:pid", authenticate, asyncHandler(async (req, res) => {
    const result = await db.collection("products").deleteOne({ _id: oid(req.params.pid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Product not found");
    res.json({ ok: true });
  }));

  api.post("/products/:pid/adjust-stock", authenticate, asyncHandler(async (req, res) => {
    const payload = validate(req.body, [
      { name: "delta", type: "int", required: true },
      { name: "reason", type: "str", required: true },
    ]);
    const prod = await db.collection("products").findOne({ _id: oid(req.params.pid) });
    if (!prod) throw new HttpError(404, "Product not found");
    const newStock = Math.max(0, parseInt(prod.stock || 0, 10) + parseInt(payload.delta, 10));
    await db.collection("products").updateOne({ _id: oid(req.params.pid) }, { $set: { stock: newStock } });
    await db.collection("stock_adjustments").insertOne({
      product_id: req.params.pid,
      product_name: prod.name,
      delta: payload.delta,
      reason: payload.reason,
      previous_stock: prod.stock || 0,
      new_stock: newStock,
      user_id: req.user.id,
      user_name: req.user.name,
      created_at: isoNow(),
    });
    await logMovement(req.user, req.params.pid, prod.name || "", payload.delta, "adjustment", payload.reason, payload.reason);
    res.json({ ok: true, stock: newStock });
  }));

  api.get("/inventory/adjustments", authenticate, asyncHandler(async (req, res) => {
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 100;
    const docs = await db.collection("stock_adjustments").find({}).sort({ created_at: -1 }).limit(limit).toArray();
    res.json(docs.map(docOut));
  }));
};
