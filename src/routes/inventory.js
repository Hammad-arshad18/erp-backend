const { db } = require("../utils/db");
const { asyncHandler, scopeQuery, docOut } = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

module.exports = (api) => {
  api.get("/inventory/movements", authenticate, asyncHandler(async (req, res) => {
    const { product_id, type, start, end } = req.query;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : 500;
    const query = scopeQuery(req.user);
    if (product_id) query.product_id = product_id;
    if (type) query.type = type;
    if (start || end) {
      const d = {};
      if (start) d.$gte = start;
      if (end) d.$lte = end;
      query.created_at = d;
    }
    const docs = await db.collection("inventory_movements").find(query).sort({ created_at: -1 }).limit(limit).toArray();
    res.json(docs.map(docOut));
  }));
};
