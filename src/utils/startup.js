const fs = require("fs");
const path = require("path");
const { db } = require("./db");
const { hashPassword, verifyPassword, isoNow } = require("./helpers");

// Mirrors @app.on_event("startup") in server.py
async function onStartup() {
  try {
    await db.collection("users").createIndex({ email: 1 }, { unique: true });
  } catch (e) {
    console.warn(`Index issue: ${e}`);
  }

  // Seed admin & cashier only (no demo business data)
  const adminEmail = process.env.ADMIN_EMAIL || "admin@market.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const existingAdmin = await db
    .collection("users")
    .findOne({ email: adminEmail });
  if (!existingAdmin) {
    await db.collection("users").insertOne({
      email: adminEmail,
      name: "Store Manager",
      role: "admin",
      password_hash: hashPassword(adminPassword),
      created_at: isoNow(),
    });
    console.log(`Seeded admin: ${adminEmail}`);
  } else if (!verifyPassword(adminPassword, existingAdmin.password_hash)) {
    await db
      .collection("users")
      .updateOne(
        { email: adminEmail },
        { $set: { password_hash: hashPassword(adminPassword) } },
      );
  }

  const cashierEmail = "cashier@market.com";
  if (!(await db.collection("users").findOne({ email: cashierEmail }))) {
    await db.collection("users").insertOne({
      email: cashierEmail,
      name: "Sam Cashier",
      role: "cashier",
      password_hash: hashPassword("cashier123"),
      created_at: isoNow(),
    });
  }

  // Seed default store
  let defaultStore = await db
    .collection("stores")
    .findOne({ is_default: true });
  if (!defaultStore) {
    const existingStore = await db.collection("stores").findOne({});
    if (existingStore) {
      await db
        .collection("stores")
        .updateOne({ _id: existingStore._id }, { $set: { is_default: true } });
      defaultStore = existingStore;
    } else {
      const res = await db.collection("stores").insertOne({
        name: "Main Store",
        address: null,
        phone: null,
        is_default: true,
        created_at: isoNow(),
      });
      defaultStore = { _id: res.insertedId, name: "Main Store" };
      console.log("Seeded default store");
    }
  }

  // Migrate existing products without store_id
  const defaultStoreId = String(defaultStore._id);
  await db
    .collection("products")
    .updateMany(
      { store_id: { $in: [null, ""] } },
      { $set: { store_id: defaultStoreId } },
    );
  await db
    .collection("products")
    .updateMany(
      { store_id: { $exists: false } },
      { $set: { store_id: defaultStoreId } },
    );

  // Ensure default store has currency/plan defaults
  const cur =
    (await db.collection("stores").findOne({ _id: defaultStore._id })) || {};
  await db.collection("stores").updateOne(
    { _id: defaultStore._id },
    {
      $set: {
        currency: cur.currency || "USD",
        currency_symbol: cur.currency_symbol || "$",
        plan: cur.plan || "enterprise",
      },
    },
  );

  // Migrate other collections to default store
  const colls = [
    "customers",
    "suppliers",
    "purchase_orders",
    "transfers",
    "promotions",
    "invoices",
    "expenses",
    "payroll",
    "stock_adjustments",
    "shifts",
    "attendance",
    "payment_transactions",
  ];
  for (const coll of colls) {
    await db
      .collection(coll)
      .updateMany(
        { store_id: { $in: [null, ""] } },
        { $set: { store_id: defaultStoreId } },
      );
    await db
      .collection(coll)
      .updateMany(
        { store_id: { $exists: false } },
        { $set: { store_id: defaultStoreId } },
      );
  }

  // Assign default store_id to admin and cashier
  await db
    .collection("users")
    .updateMany(
      { store_id: { $in: [null, "", null] }, role: { $ne: "super_admin" } },
      { $set: { store_id: defaultStoreId } },
    );
  await db
    .collection("users")
    .updateMany(
      { store_id: { $exists: false }, role: { $ne: "super_admin" } },
      { $set: { store_id: defaultStoreId } },
    );

  // Seed super admin
  const superEmail = process.env.SUPER_ADMIN_EMAIL || "super@market.com";
  const superPassword = process.env.SUPER_ADMIN_PASSWORD || "super123";
  const existingSuper = await db
    .collection("users")
    .findOne({ email: superEmail });
  if (!existingSuper) {
    await db.collection("users").insertOne({
      email: superEmail,
      name: "Super Admin",
      role: "super_admin",
      password_hash: hashPassword(superPassword),
      store_id: null,
      permissions: [],
      created_at: isoNow(),
    });
    console.log(`Seeded super admin: ${superEmail}`);
  } else if (!verifyPassword(superPassword, existingSuper.password_hash)) {
    await db
      .collection("users")
      .updateOne(
        { email: superEmail },
        { $set: { password_hash: hashPassword(superPassword) } },
      );
  }

  try {
    const memPath = "/app/memory";
    fs.mkdirSync(memPath, { recursive: true });
    const creds = `# Test Credentials

## Super Admin
- Email: super@market.com
- Password: super123
- Role: super_admin

## Admin (Main Store)
- Email: admin@market.com
- Password: admin123
- Role: admin

## Cashier (Main Store)
- Email: cashier@market.com
- Password: cashier123
- Role: cashier

## Auth endpoints
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me
`;
    fs.writeFileSync(path.join(memPath, "test_credentials.md"), creds);
  } catch (e) {
    console.warn(`Could not write test_credentials: ${e}`);
  }
}

module.exports = { onStartup };
