const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, docOut, oid, isoNow, hashPassword,
} = require("../utils/helpers");
const { authenticate, requireAdmin } = require("../middlewares/auth");

const VALID_ROLES = ["admin", "manager", "cashier"];

module.exports = (api) => {
  api.get("/staff/directory", authenticate, asyncHandler(async (req, res) => {
    const query = req.user.role === "super_admin" ? {} : { role: { $ne: "super_admin" } };
    const docs = await db.collection("users").find(query).sort({ name: 1 }).toArray();
    const stores = await db.collection("stores").find({}).toArray();
    const storeMap = {};
    stores.forEach(s => storeMap[s._id.toString()] = s.name);
    
    // Only return non-sensitive fields
    res.json(docs.map(doc => ({ 
      id: doc._id.toString(), 
      name: doc.name, 
      role: doc.role,
      store_name: storeMap[doc.store_id] || "Main Store"
    })));
  }));

  api.get("/staff", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const query = req.user.role === "super_admin" ? {} : { role: { $ne: "super_admin" } };
    const docs = await db.collection("users").find(query).sort({ created_at: -1 }).limit(200).toArray();
    res.json(docs.map(docOut));
  }));

  api.post("/staff", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const payload = validate(req.body, [
      { name: "email", type: "str", required: true, email: true },
      { name: "password", type: "str", required: true },
      { name: "name", type: "str", required: true },
      { name: "role", type: "str", default: "cashier" },
      { name: "monthly_salary", type: "float", default: 0 },
      { name: "sales_target", type: "float", default: 0 },
      { name: "hourly_rate", type: "float", default: 0 },
      { name: "overtime_multiplier", type: "float", default: 1.5 },
      { name: "store_id", type: "str" },
      { name: "permissions", type: "list" },
    ]);
    const email = payload.email.toLowerCase();
    if (await db.collection("users").findOne({ email })) {
      throw new HttpError(400, "Email already registered");
    }
    if (!VALID_ROLES.includes(payload.role)) throw new HttpError(400, "Invalid role");
    const doc = {
      email,
      name: payload.name,
      role: payload.role,
      monthly_salary: payload.monthly_salary || 0,
      sales_target: payload.sales_target || 0,
      hourly_rate: payload.hourly_rate || 0,
      overtime_multiplier: payload.overtime_multiplier || 1.5,
      store_id: payload.store_id,
      permissions: payload.permissions || [],
      password_hash: hashPassword(payload.password),
      created_at: isoNow(),
    };
    const result = await db.collection("users").insertOne(doc);
    doc._id = result.insertedId;
    res.json(docOut(doc));
  }));

  api.patch("/staff/:uid", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    const payload = validate(req.body, [
      { name: "name", type: "str" },
      { name: "role", type: "str" },
      { name: "password", type: "str" },
      { name: "monthly_salary", type: "float" },
      { name: "sales_target", type: "float" },
      { name: "hourly_rate", type: "float" },
      { name: "overtime_multiplier", type: "float" },
      { name: "store_id", type: "str" },
      { name: "permissions", type: "list" },
    ], { partial: true });

    const update = {};
    if (payload.name !== undefined) update.name = payload.name;
    if (payload.role !== undefined) {
      if (!VALID_ROLES.includes(payload.role)) throw new HttpError(400, "Invalid role");
      update.role = payload.role;
    }
    if (payload.password) update.password_hash = hashPassword(payload.password);
    if (payload.monthly_salary !== undefined) update.monthly_salary = payload.monthly_salary;
    if (payload.sales_target !== undefined) update.sales_target = payload.sales_target;
    if (payload.hourly_rate !== undefined) update.hourly_rate = payload.hourly_rate;
    if (payload.overtime_multiplier !== undefined) update.overtime_multiplier = payload.overtime_multiplier;
    if (payload.store_id !== undefined) update.store_id = payload.store_id;
    if (payload.permissions !== undefined) update.permissions = payload.permissions;
    if (Object.keys(update).length === 0) throw new HttpError(400, "No fields to update");
    const result = await db.collection("users").updateOne({ _id: oid(req.params.uid) }, { $set: update });
    if (result.matchedCount === 0) throw new HttpError(404, "Staff not found");
    const doc = await db.collection("users").findOne({ _id: oid(req.params.uid) });
    res.json(docOut(doc));
  }));

  api.delete("/staff/:uid", authenticate, requireAdmin, asyncHandler(async (req, res) => {
    if (req.params.uid === req.user.id) throw new HttpError(400, "Cannot delete yourself");
    const result = await db.collection("users").deleteOne({ _id: oid(req.params.uid) });
    if (result.deletedCount === 0) throw new HttpError(404, "Staff not found");
    res.json({ ok: true });
  }));
};
