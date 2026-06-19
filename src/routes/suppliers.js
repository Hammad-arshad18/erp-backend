const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, scopeQuery, stampStore, docOut, oid, isoNow,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

const CREATE_FIELDS = [
  { name: "name", type: "str", required: true },
  { name: "contact_name", type: "str" },
  { name: "email", type: "str", email: true },
  { name: "phone", type: "str" },
  { name: "address", type: "str" },
  { name: "notes", type: "str" },
];

const UPDATE_FIELDS = [
  { name: "name", type: "str" },
  { name: "contact_name", type: "str" },
  { name: "email", type: "str", email: true },
  { name: "phone", type: "str" },
  { name: "address", type: "str" },
  { name: "notes", type: "str" },
];

module.exports = (api) => {
  api.get("/suppliers", authenticate, asyncHandler(async (req, res) => {
    const query = scopeQuery(req.user);
    const { q } = req.query;
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { contact_name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];
    }
    const docs = await db.collection("suppliers").find(query).sort({ created_at: -1 }).limit(500).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/suppliers", authenticate, asyncHandler(async (req, res) => {
    const doc = validate(req.body, CREATE_FIELDS);
    doc.created_at = isoNow();
    stampStore(req.user, doc);
    const result = await db.collection("suppliers").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.patch("/suppliers/:sid", authenticate, asyncHandler(async (req, res) => {
    const update = validate(req.body, UPDATE_FIELDS, { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    const result = await db.collection("suppliers").updateOne({ _id: oid(req.params.sid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Supplier not found");
    const doc = await db.collection("suppliers").findOne({ _id: oid(req.params.sid) });
    res.json(docOut(doc));
  }));

  api.delete("/suppliers/:sid", authenticate, asyncHandler(async (req, res) => {
    const result = await db.collection("suppliers").deleteOne({ _id: oid(req.params.sid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Supplier not found");
    res.json({ ok: true });
  }));
};
