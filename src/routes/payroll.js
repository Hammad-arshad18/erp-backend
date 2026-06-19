const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, docOut, oid, isoNow,
} = require("../utils/helpers");
const { authenticate, requireAdmin } = require("../middlewares/auth");

module.exports = (api) => {
  api.get("/payroll", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const query = {};
    if (req.query.staff_id) query.staff_id = req.query.staff_id;
    const docs = await db.collection("payroll").find(query).sort({ created_at: -1 }).limit(1000).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/payroll", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const payload = validate(req.body, [
      { name: "staff_id", type: "str", required: true },
      { name: "month", type: "str", required: true },
      { name: "amount", type: "float", required: true },
      { name: "notes", type: "str" },
    ]);
    const staff = await db.collection("users").findOne({ _id: oid(payload.staff_id) });
    if (!staff) throw new HttpError(400, "Staff not found");
    const doc = {
      staff_id: payload.staff_id,
      staff_name: staff.name,
      month: payload.month,
      amount: payload.amount,
      notes: payload.notes,
      paid_at: isoNow(),
      paid_by: req.user.id,
      created_at: isoNow(),
    };
    const result = await db.collection("payroll").insertOne(doc);
    doc._id = result.insertedId;
    // Also log as expense for P&L
    await db.collection("expenses").insertOne({
      category: "salaries",
      description: `Salary ${payload.month} - ${staff.name}`,
      amount: payload.amount,
      date: doc.paid_at,
      notes: payload.notes,
      linked_payroll_id: String(result.insertedId),
      created_by: req.user.id,
      created_at: doc.created_at,
    });
    res.json(docOut(doc));
  }));

  api.delete("/payroll/:pid", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    await db.collection("expenses").deleteMany({ linked_payroll_id: req.params.pid });
    const result = await db.collection("payroll").deleteOne({ _id: oid(req.params.pid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Payment not found");
    res.json({ ok: true });
  }));
};
