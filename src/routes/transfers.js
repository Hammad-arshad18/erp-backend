const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, stampStore, docOut, oid, isoNow, hasPerm, logMovement,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

function utcCompactToday() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

module.exports = (api) => {
  api.get("/transfers", authenticate, asyncHandler(async (req, res) => {
    const docs = await db.collection("transfers").find({}).sort({ created_at: -1 }).limit(500).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/transfers", authenticate, asyncHandler(async (req, res) => {
    if (!hasPerm(req.user, "manage_transfers")) throw new HttpError(403, "Missing permission: manage_transfers");
    const body = req.body || {};
    const head = validate(body, [
      { name: "source_store_id", type: "str", required: true },
      { name: "dest_store_id", type: "str", required: true },
      { name: "notes", type: "str" },
    ]);
    const rawItems = body.items;
    if (!Array.isArray(rawItems)) {
      throw new HttpError(422, [{ type: "missing", loc: ["body", "items"], msg: "Field required" }]);
    }
    const items = rawItems.map((it) => validate(it, [
      { name: "product_id", type: "str", required: true },
      { name: "name", type: "str", required: true },
      { name: "qty", type: "int", required: true },
    ]));

    if (head.source_store_id === head.dest_store_id) throw new HttpError(400, "Source and destination must differ");
    const src = await db.collection("stores").findOne({ _id: oid(head.source_store_id) });
    const dst = await db.collection("stores").findOne({ _id: oid(head.dest_store_id) });
    if (!src || !dst) throw new HttpError(400, "Invalid store");
    // Validate stock at source
    for (const it of items) {
      const prod = await db.collection("products").findOne({ _id: oid(it.product_id) });
      if (!prod || prod.store_id !== head.source_store_id) {
        throw new HttpError(400, `Product not found in source store: ${it.name}`);
      }
      if ((prod.stock || 0) < it.qty) throw new HttpError(400, `Insufficient stock for ${it.name}`);
    }

    const today = utcCompactToday();
    const count = await db.collection("transfers").countDocuments({ transfer_number: { $regex: `^TRF-${today}-` } });
    const doc = {
      transfer_number: `TRF-${today}-${String(count + 1).padStart(4, "0")}`,
      source_store_id: head.source_store_id,
      source_store_name: src.name,
      dest_store_id: head.dest_store_id,
      dest_store_name: dst.name,
      items: items.map((i) => ({ ...i })),
      status: "pending",
      notes: head.notes,
      created_by: req.user.id,
      created_at: isoNow(),
      received_at: null,
    };
    stampStore(req.user, doc);
    for (const it of items) {
      await db.collection("products").updateOne({ _id: oid(it.product_id) }, { $inc: { stock: -it.qty } });
      await logMovement(req.user, it.product_id, it.name, -it.qty, "transfer_out", doc.transfer_number);
    }
    const result = await db.collection("transfers").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.post("/transfers/:tid/receive", authenticate, asyncHandler(async (req, res) => {
    if (!hasPerm(req.user, "manage_transfers")) throw new HttpError(403, "Missing permission");
    const doc = await db.collection("transfers").findOne({ _id: oid(req.params.tid) });
    if (!doc) throw new HttpError(404, "Transfer not found");
    if (doc.status !== "pending") throw new HttpError(400, "Already processed");
    for (const it of doc.items || []) {
      const srcProd = await db.collection("products").findOne({ _id: oid(it.product_id) });
      if (!srcProd) continue;
      const query = { store_id: doc.dest_store_id };
      if (srcProd.sku) query.sku = srcProd.sku;
      else query.name = srcProd.name;
      const destProd = await db.collection("products").findOne(query);
      if (destProd) {
        await db.collection("products").updateOne({ _id: destProd._id }, { $inc: { stock: it.qty } });
        await logMovement(req.user, String(destProd._id), destProd.name || "", it.qty, "transfer_in", doc.transfer_number || "");
      } else {
        const newDoc = {};
        for (const [k, v] of Object.entries(srcProd)) {
          if (k !== "_id") newDoc[k] = v;
        }
        newDoc.store_id = doc.dest_store_id;
        newDoc.stock = it.qty;
        newDoc.created_at = isoNow();
        const ins = await db.collection("products").insertOne(newDoc);
        await logMovement(req.user, String(ins.insertedId), srcProd.name || "", it.qty, "transfer_in", doc.transfer_number || "");
      }
    }
    await db.collection("transfers").updateOne({ _id: oid(req.params.tid) }, { $set: { status: "received", received_at: isoNow() } });
    res.json({ ok: true });
  }));

  api.post("/transfers/:tid/cancel", authenticate, asyncHandler(async (req, res) => {
    if (!hasPerm(req.user, "manage_transfers")) throw new HttpError(403, "Missing permission");
    const doc = await db.collection("transfers").findOne({ _id: oid(req.params.tid) });
    if (!doc) throw new HttpError(404, "Transfer not found");
    if (doc.status !== "pending") throw new HttpError(400, "Cannot cancel");
    for (const it of doc.items || []) {
      try {
        await db.collection("products").updateOne({ _id: oid(it.product_id) }, { $inc: { stock: it.qty } });
      } catch (e) {
        // pass
      }
    }
    await db.collection("transfers").updateOne({ _id: oid(req.params.tid) }, { $set: { status: "cancelled" } });
    res.json({ ok: true });
  }));
};
