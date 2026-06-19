const { db } = require("../utils/db");
const {
  asyncHandler, HttpError, validate, verifyPassword, setAuthCookies,
  createAccessToken, createRefreshToken, docOut, oid,
} = require("../utils/helpers");
const { PLAN_MODULES, currencySymbolFor } = require("../utils/constants");
const { authenticate } = require("../middlewares/auth");

module.exports = (api) => {
  // ---- Auth Routes ----
  api.post("/auth/login", asyncHandler(async (req, res) => {
    const payload = validate(req.body, [
      { name: "email", type: "str", required: true, email: true },
      { name: "password", type: "str", required: true },
    ]);
    const email = payload.email.toLowerCase();
    const user = await db.collection("users").findOne({ email });
    if (!user || !verifyPassword(payload.password, user.password_hash)) {
      throw new HttpError(401, "Invalid email or password");
    }
    const uid = String(user._id);
    setAuthCookies(res, createAccessToken(uid, email), createRefreshToken(uid));
    res.json(docOut(user));
  }));

  api.post("/auth/logout", asyncHandler(async (req, res) => {
    res.clearCookie("access_token", { path: "/" });
    res.clearCookie("refresh_token", { path: "/" });
    res.json({ ok: true });
  }));

  api.get("/auth/me", authenticate, asyncHandler(async (req, res) => {
    const user = req.user;
    const out = { ...user };
    const sid = user.store_id;
    if (sid) {
      try {
        const store = await db.collection("stores").findOne({ _id: oid(sid) });
        if (store) {
          const modules = store.modules_override || PLAN_MODULES[store.plan || "enterprise"] || [];
          out.store_name = store.name;
          out.store_currency = store.currency || "USD";
          out.store_currency_symbol = store.currency_symbol || currencySymbolFor(store.currency || "USD");
          out.store_plan = store.plan || "enterprise";
          out.store_modules = modules;
        }
      } catch (e) {
        // pass
      }
    }
    if (user.role === "super_admin") {
      out.store_modules = PLAN_MODULES.enterprise;
      if (out.store_currency === undefined) out.store_currency = "USD";
      if (out.store_currency_symbol === undefined) out.store_currency_symbol = "$";
    }
    res.json(out);
  }));
};
