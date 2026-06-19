const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, stampStore, docOut, oid, isoNow,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

const CREATE_FIELDS = [
  { name: "name", type: "str", required: true },
  { name: "email", type: "str", email: true },
  { name: "phone", type: "str" },
  { name: "tier", type: "str", default: "Bronze" },
  { name: "loyalty_points", type: "int", default: 0 },
  { name: "notes", type: "str" },
];

const UPDATE_FIELDS = [
  { name: "name", type: "str" },
  { name: "email", type: "str", email: true },
  { name: "phone", type: "str" },
  { name: "tier", type: "str" },
  { name: "loyalty_points", type: "int" },
  { name: "notes", type: "str" },
];

module.exports = (api) => {
  api.get("/customers", authenticate, asyncHandler(async (req, res) => {
    const query = scopeQuery(req.user);
    const { q, tier } = req.query;
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }
    if (tier) query.tier = tier;
    const docs = await db.collection("customers").find(query).sort({ created_at: -1 }).limit(1000).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/customers", authenticate, asyncHandler(async (req, res) => {
    const doc = validate(req.body, CREATE_FIELDS);
    doc.created_at = isoNow();
    stampStore(req.user, doc);
    const result = await db.collection("customers").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.get("/customers/:cid", authenticate, asyncHandler(async (req, res) => {
    const doc = await db.collection("customers").findOne({ _id: oid(req.params.cid) });
    if (!doc) throw new HttpError(404, "Customer not found");
    const invs = await db.collection("invoices").find({ customer_id: req.params.cid }).sort({ created_at: -1 }).limit(20).toArray();
    res.json({ customer: docOut(doc), invoices: invs.map(docOut) });
  }));

  api.patch("/customers/:cid", authenticate, asyncHandler(async (req, res) => {
    const update = validate(req.body, UPDATE_FIELDS, { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    const result = await db.collection("customers").updateOne({ _id: oid(req.params.cid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Customer not found");
    const doc = await db.collection("customers").findOne({ _id: oid(req.params.cid) });
    res.json(docOut(doc));
  }));

  api.delete("/customers/:cid", authenticate, asyncHandler(async (req, res) => {
    const result = await db.collection("customers").deleteOne({ _id: oid(req.params.cid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Customer not found");
    res.json({ ok: true });
  }));
};
