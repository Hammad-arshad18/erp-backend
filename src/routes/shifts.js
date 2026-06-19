const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, docOut, oid, isoNow, hasPerm,
} = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

module.exports = (api) => {
  api.get("/shifts", authenticate, asyncHandler(async (req, res) => {
    const { staff_id, start, end } = req.query;
    const query = {};
    if (staff_id) {
      query.staff_id = staff_id;
    } else if (req.user.role !== "admin" && !hasPerm(req.user, "manage_attendance")) {
      query.staff_id = req.user.id;
    }
    if (start || end) {
      const d = {};
      if (start) d.$gte = start.slice(0, 10);
      if (end) d.$lte = end.slice(0, 10);
      query.date = d;
    }
    const docs = await db.collection("shifts").find(query).sort({ date: 1 }).limit(1000).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/shifts", authenticate, asyncHandler(async (req, res) => {
    if (req.user.role !== "admin" && !hasPerm(req.user, "manage_attendance")) {
      throw new HttpError(403, "Missing permission: manage_attendance");
    }
    const doc = validate(req.body, [
      { name: "staff_id", type: "str", required: true },
      { name: "date", type: "str", required: true },
      { name: "start_time", type: "str", required: true },
      { name: "end_time", type: "str", required: true },
      { name: "notes", type: "str" },
    ]);
    const staff = await db.collection("users").findOne({ _id: oid(doc.staff_id) });
    if (!staff) throw new HttpError(400, "Staff not found");
    doc.staff_name = staff.name;
    doc.created_by = req.user.id;
    doc.created_at = isoNow();
    const result = await db.collection("shifts").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.patch("/shifts/:sid", authenticate, asyncHandler(async (req, res) => {
    if (req.user.role !== "admin" && !hasPerm(req.user, "manage_attendance")) {
      throw new HttpError(403, "Missing permission");
    }
    const update = validate(req.body, [
      { name: "date", type: "str" },
      { name: "start_time", type: "str" },
      { name: "end_time", type: "str" },
      { name: "notes", type: "str" },
    ], { partial: true });
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields");
    const result = await db.collection("shifts").updateOne({ _id: oid(req.params.sid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Shift not found");
    const doc = await db.collection("shifts").findOne({ _id: oid(req.params.sid) });
    res.json(docOut(doc));
  }));

  api.delete("/shifts/:sid", authenticate, asyncHandler(async (req, res) => {
    if (req.user.role !== "admin" && !hasPerm(req.user, "manage_attendance")) {
      throw new HttpError(403, "Missing permission");
    }
    const result = await db.collection("shifts").deleteOne({ _id: oid(req.params.sid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Shift not found");
    res.json({ ok: true });
  }));
};
