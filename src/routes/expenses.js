const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, stampStore, docOut, oid, isoNow,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

const CREATE_FIELDS = [
  { name: "category", type: "str", required: true },
  { name: "description", type: "str", required: true },
  { name: "amount", type: "float", required: true },
  { name: "date", type: "str" },
  { name: "notes", type: "str" },
];

const UPDATE_FIELDS = [
  { name: "category", type: "str" },
  { name: "description", type: "str" },
  { name: "amount", type: "float" },
  { name: "date", type: "str" },
  { name: "notes", type: "str" },
];

module.exports = (api) => {
  api.get("/expenses", authenticate, asyncHandler(async (req, res) => {
    const query = scopeQuery(req.user);
    const { start, end } = req.query;
    if (start || end) {
      const d = {};
      if (start) d.$gte = start;
      if (end) d.$lte = end;
      query.date = d;
    }
    const docs = await db.collection("expenses").find(query).sort({ date: -1 }).limit(1000).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/expenses", authenticate, asyncHandler(async (req, res) => {
    const doc = validate(req.body, CREATE_FIELDS);
    doc.date = doc.date || isoNow();
    doc.created_by = req.user.id;
    doc.created_at = isoNow();
    stampStore(req.user, doc);
    const result = await db.collection("expenses").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.patch("/expenses/:eid", authenticate, asyncHandler(async (req, res) => {
    const update = validate(req.body, UPDATE_FIELDS, { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    const result = await db.collection("expenses").updateOne({ _id: oid(req.params.eid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Expense not found");
    const doc = await db.collection("expenses").findOne({ _id: oid(req.params.eid) });
    res.json(docOut(doc));
  }));

  api.delete("/expenses/:eid", authenticate, asyncHandler(async (req, res) => {
    const result = await db.collection("expenses").deleteOne({ _id: oid(req.params.eid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Expense not found");
    res.json({ ok: true });
  }));
};
