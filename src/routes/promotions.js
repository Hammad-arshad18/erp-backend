const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, stampStore, docOut, oid, isoNow,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

const CREATE_FIELDS = [
  { name: "title", type: "str", required: true },
  { name: "description", type: "str", required: true },
  { name: "discount_percent", type: "float", required: true },
  { name: "starts_at", type: "str" },
  { name: "ends_at", type: "str" },
  { name: "status", type: "str", default: "active" },
];

const UPDATE_FIELDS = [
  { name: "title", type: "str" },
  { name: "description", type: "str" },
  { name: "discount_percent", type: "float" },
  { name: "starts_at", type: "str" },
  { name: "ends_at", type: "str" },
  { name: "status", type: "str" },
];

module.exports = (api) => {
  api.get("/promotions", authenticate, asyncHandler(async (req, res) => {
    const docs = await db.collection("promotions").find(scopeQuery(req.user)).sort({ created_at: -1 }).limit(500).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/promotions", authenticate, asyncHandler(async (req, res) => {
    const doc = validate(req.body, CREATE_FIELDS);
    doc.created_at = isoNow();
    stampStore(req.user, doc);
    const result = await db.collection("promotions").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.patch("/promotions/:pid", authenticate, asyncHandler(async (req, res) => {
    const update = validate(req.body, UPDATE_FIELDS, { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    const result = await db.collection("promotions").updateOne({ _id: oid(req.params.pid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Promotion not found");
    const doc = await db.collection("promotions").findOne({ _id: oid(req.params.pid) });
    res.json(docOut(doc));
  }));

  api.delete("/promotions/:pid", authenticate, asyncHandler(async (req, res) => {
    const result = await db.collection("promotions").deleteOne({ _id: oid(req.params.pid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Promotion not found");
    res.json({ ok: true });
  }));
};
