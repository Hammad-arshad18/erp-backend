const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, docOut, oid, isoNow, isoDateToday, hasPerm, round2,
} = require("../utils/helpers");
const { authenticate, requireAdmin } = require("../middlewares/auth");

module.exports = (api) => {
  api.post("/attendance/clock-in", authenticate, asyncHandler(async (req, res) => {
    const payload = validate(req.body, [{ name: "notes", type: "str" }]);
    const openShift = await db.collection("attendance").findOne({ staff_id: req.user.id, clock_out: null });
    if (openShift) throw new HttpError(400, "Already clocked in");
    const doc = {
      staff_id: req.user.id,
      staff_name: req.user.name,
      clock_in: isoNow(),
      clock_out: null,
      hours_regular: 0.0,
      hours_overtime: 0.0,
      earnings: 0.0,
      date: isoDateToday(),
      notes: payload.notes,
    };
    const result = await db.collection("attendance").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.post("/attendance/clock-out", authenticate, asyncHandler(async (req, res) => {
    const payload = validate(req.body, [{ name: "notes", type: "str" }]);
    const shift = await db.collection("attendance").findOne({ staff_id: req.user.id, clock_out: null });
    if (!shift) throw new HttpError(400, "No open shift");
    const now = new Date();
    const start = new Date(shift.clock_in);
    const hours = Math.max(0.0, (now.getTime() - start.getTime()) / 1000 / 3600);
    const regular = Math.min(hours, 8.0);
    const overtime = Math.max(0.0, hours - 8.0);
    const u = await db.collection("users").findOne({ _id: oid(req.user.id) });
    const rate = parseFloat(u.hourly_rate || 0) || 0;
    const otMul = parseFloat(u.overtime_multiplier || 1.5) || 1.5;
    const earnings = round2(regular * rate + overtime * rate * otMul);
    const update = {
      clock_out: isoNow(),
      hours_regular: round2(regular),
      hours_overtime: round2(overtime),
      earnings,
    };
    if (payload.notes) {
      update.notes = (shift.notes || "") + " | " + payload.notes;
    }
    await db.collection("attendance").updateOne({ _id: shift._id }, { $set: update });
    const doc = await db.collection("attendance").findOne({ _id: shift._id });
    res.json(docOut(doc));
  }));

  api.get("/attendance/open", authenticate, asyncHandler(async (req, res) => {
    const shift = await db.collection("attendance").findOne({ staff_id: req.user.id, clock_out: null });
    res.json(shift ? docOut(shift) : null);
  }));

  api.get("/attendance/timesheet", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const { staff_id, start, end } = req.query;
    if (staff_id === undefined || start === undefined || end === undefined) {
      const errors = [];
      if (staff_id === undefined) errors.push({ type: "missing", loc: ["query", "staff_id"], msg: "Field required" });
      if (start === undefined) errors.push({ type: "missing", loc: ["query", "start"], msg: "Field required" });
      if (end === undefined) errors.push({ type: "missing", loc: ["query", "end"], msg: "Field required" });
      throw new HttpError(422, errors);
    }
    const query = {
      staff_id,
      date: { $gte: start.slice(0, 10), $lte: end.slice(0, 10) },
      clock_out: { $ne: null },
    };
    const docs = await db.collection("attendance").find(query).sort({ date: 1 }).limit(500).toArray();
    const totalRegular = docs.reduce((acc, d) => acc + (d.hours_regular || 0), 0);
    const totalOvertime = docs.reduce((acc, d) => acc + (d.hours_overtime || 0), 0);
    const totalEarnings = docs.reduce((acc, d) => acc + (d.earnings || 0), 0);
    res.json({
      staff_id,
      start,
      end,
      shifts: docs.map(docOut),
      total_hours_regular: round2(totalRegular),
      total_hours_overtime: round2(totalOvertime),
      total_earnings: round2(totalEarnings),
    });
  }));

  api.get("/attendance", authenticate, asyncHandler(async (req, res) => {
    const { staff_id, start, end } = req.query;
    const query = {};
    if (staff_id) {
      query.staff_id = staff_id;
    } else if (!hasPerm(req.user, "manage_attendance")) {
      query.staff_id = req.user.id;
    }
    if (start || end) {
      const d = {};
      if (start) d.$gte = start.slice(0, 10);
      if (end) d.$lte = end.slice(0, 10);
      query.date = d;
    }
    const docs = await db.collection("attendance").find(query).sort({ clock_in: -1 }).limit(500).toArray();
    res.json(docs.map(docOut));
  }));
};
