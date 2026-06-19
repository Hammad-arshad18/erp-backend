const { db } = require("../utils/db");
const { asyncHandler, scopeQuery, oid, round, round2 } = require("../utils/helpers");
const { authenticate } = require("../middlewares/auth");

function isoFromDate(date) {
  return date.toISOString().replace("Z", "000+00:00");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function midnightUtcIso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}T00:00:00+00:00`;
}

module.exports = (api) => {
  api.get("/analytics/dashboard", authenticate, asyncHandler(async (req, res) => {
    const now = new Date();
    const scope = scopeQuery(req.user);

    const totalCustomers = await db.collection("customers").countDocuments(scope);
    const totalProducts = await db.collection("products").countDocuments(scope);
    const activePromos = await db.collection("promotions").countDocuments({ ...scope, status: "active" });

    const pipelineTotal = [{ $match: scope }, { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } }];
    const agg = await db.collection("invoices").aggregate(pipelineTotal).toArray();
    const totalRevenue = agg.length ? agg[0].total : 0;
    const totalOrders = agg.length ? agg[0].count : 0;

    // Last 7 days revenue
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(base.getTime() - i * 86400000);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const dd = d.getUTCDate();
      const start = midnightUtcIso(y, m, dd);
      const nd = new Date(d.getTime() + 86400000);
      const end = midnightUtcIso(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate());
      const pipeline = [
        { $match: { ...scope, created_at: { $gte: start, $lt: end } } },
        { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
      ];
      const r = await db.collection("invoices").aggregate(pipeline).toArray();
      days.push({
        day: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        date: `${y}-${pad(m)}-${pad(dd)}`,
        revenue: r.length ? round2(r[0].revenue) : 0,
        orders: r.length ? r[0].orders : 0,
      });
    }

    const tierPipeline = [{ $match: scope }, { $group: { _id: "$tier", count: { $sum: 1 } } }];
    const tierAgg = await db.collection("customers").aggregate(tierPipeline).toArray();
    const tiers = tierAgg.map((t) => ({ tier: t._id || "Bronze", count: t.count }));

    // Low stock count
    let lowStock = 0;
    const prods = await db.collection("products").find(scope).toArray();
    for (const p of prods) {
      if ((p.stock || 0) <= (p.reorder_level !== undefined && p.reorder_level !== null ? p.reorder_level : 10)) {
        lowStock += 1;
      }
    }

    // Top customers
    const topCustPipeline = [
      { $match: { ...scope, customer_id: { $ne: null } } },
      { $group: { _id: "$customer_id", total: { $sum: "$total" }, orders: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
    ];
    const topRaw = await db.collection("invoices").aggregate(topCustPipeline).toArray();
    const topCustomers = [];
    for (const r of topRaw) {
      let cust = null;
      try {
        cust = r._id ? await db.collection("customers").findOne({ _id: oid(r._id) }) : null;
      } catch (e) {
        cust = null;
      }
      if (cust) {
        topCustomers.push({ name: cust.name, tier: cust.tier, total: round2(r.total), orders: r.orders });
      }
    }

    res.json({
      kpis: {
        total_customers: totalCustomers,
        total_products: totalProducts,
        active_promotions: activePromos,
        total_revenue: round2(totalRevenue),
        total_orders: totalOrders,
        low_stock_count: lowStock,
      },
      weekly_revenue: days,
      tier_distribution: tiers,
      top_customers: topCustomers,
    });
  }));

  api.get("/reports/sales", authenticate, asyncHandler(async (req, res) => {
    const now = new Date();
    let { start, end } = req.query;
    if (!start) start = isoFromDate(new Date(now.getTime() - 30 * 86400000));
    if (!end) end = isoFromDate(now);

    const match = { ...scopeQuery(req.user), created_at: { $gte: start, $lte: end } };

    const pipeline = [
      { $match: match },
      { $group: { _id: null, revenue: { $sum: "$total" }, tax: { $sum: "$tax_amount" }, discount: { $sum: "$discount" }, orders: { $sum: 1 } } },
    ];
    const agg = await db.collection("invoices").aggregate(pipeline).toArray();
    const base = agg.length ? agg[0] : { revenue: 0, tax: 0, discount: 0, orders: 0 };
    const totals = {
      revenue: round2(base.revenue || 0),
      tax: round2(base.tax || 0),
      discount: round2(base.discount || 0),
      orders: base.orders || 0,
    };

    const dailyPipeline = [
      { $match: match },
      { $group: { _id: { $substr: ["$created_at", 0, 10] }, revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ];
    const daily = await db.collection("invoices").aggregate(dailyPipeline).toArray();
    const dailyOut = daily.map((d) => ({ date: d._id, revenue: round2(d.revenue), orders: d.orders }));

    const topProdPipeline = [
      { $match: match },
      { $unwind: "$items" },
      { $group: { _id: "$items.product_id", name: { $first: "$items.name" }, qty: { $sum: "$items.qty" }, revenue: { $sum: "$items.line_total" } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ];
    const topProdRaw = await db.collection("invoices").aggregate(topProdPipeline).toArray();
    const topProducts = topProdRaw.map((t) => ({ name: t.name, qty: t.qty, revenue: round2(t.revenue || 0) }));

    // Category breakdown - product lookup
    const catMap = {};
    const invs = await db.collection("invoices").find(match).toArray();
    for (const inv of invs) {
      for (const it of inv.items || []) {
        let cat;
        try {
          const prod = await db.collection("products").findOne({ _id: oid(it.product_id) });
          cat = prod ? (prod.category || "Uncategorized") : "Uncategorized";
        } catch (e) {
          cat = "Uncategorized";
        }
        if (!catMap[cat]) catMap[cat] = { category: cat, revenue: 0, qty: 0 };
        catMap[cat].revenue += it.line_total || 0;
        catMap[cat].qty += it.qty || 0;
      }
    }
    const categories = Object.values(catMap)
      .map((c) => ({ category: c.category, revenue: round2(c.revenue), qty: c.qty }))
      .sort((a, b) => b.revenue - a.revenue);

    const payPipeline = [
      { $match: match },
      { $group: { _id: "$payment_method", total: { $sum: "$total" }, count: { $sum: 1 } } },
    ];
    const payRaw = await db.collection("invoices").aggregate(payPipeline).toArray();
    const payments = payRaw.map((p) => ({ method: p._id || "cash", total: round2(p.total), count: p.count }));

    res.json({
      totals,
      daily: dailyOut,
      top_products: topProducts,
      categories,
      payments,
      range: { start, end },
    });
  }));

  api.get("/reports/pnl", authenticate, asyncHandler(async (req, res) => {
    const now = new Date();
    let { start, end } = req.query;
    if (!start) start = isoFromDate(new Date(now.getTime() - 30 * 86400000));
    if (!end) end = isoFromDate(now);

    const match = { ...scopeQuery(req.user), created_at: { $gte: start, $lte: end } };

    const revPipeline = [
      { $match: match },
      { $group: { _id: null, revenue: { $sum: "$subtotal" }, tax: { $sum: "$tax_amount" }, discount: { $sum: "$discount" }, orders: { $sum: 1 } } },
    ];
    const revAgg = await db.collection("invoices").aggregate(revPipeline).toArray();
    const revenue = revAgg.length ? round2(revAgg[0].revenue) : 0;
    const tax = revAgg.length ? round2(revAgg[0].tax) : 0;
    const discount = revAgg.length ? round2(revAgg[0].discount) : 0;
    const orders = revAgg.length ? revAgg[0].orders : 0;

    // COGS
    let cogs = 0;
    const invs = await db.collection("invoices").find(match).toArray();
    for (const inv of invs) {
      for (const it of inv.items || []) {
        let cost = 0;
        try {
          const prod = await db.collection("products").findOne({ _id: oid(it.product_id) });
          cost = (prod ? prod.cost || 0 : 0) || 0;
        } catch (e) {
          cost = 0;
        }
        cogs += cost * (it.qty || 0);
      }
    }
    cogs = round2(cogs);

    const expMatch = { ...scopeQuery(req.user), date: { $gte: start, $lte: end } };
    const expPipeline = [
      { $match: expMatch },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
    ];
    const expAgg = await db.collection("expenses").aggregate(expPipeline).toArray();
    const expensesByCat = expAgg.map((e) => ({ category: e._id || "other", total: round2(e.total) }));
    const expensesTotal = round2(expensesByCat.reduce((acc, e) => acc + e.total, 0));

    const grossProfit = round2(revenue - cogs);
    const netProfit = round2(grossProfit - expensesTotal);
    const grossMargin = revenue ? round2((grossProfit / revenue) * 100) : 0;
    const netMargin = revenue ? round2((netProfit / revenue) * 100) : 0;

    res.json({
      range: { start, end },
      revenue,
      tax_collected: tax,
      discount_given: discount,
      orders,
      cogs,
      gross_profit: grossProfit,
      expenses_by_category: expensesByCat,
      expenses_total: expensesTotal,
      net_profit: netProfit,
      gross_margin_percent: grossMargin,
      net_margin_percent: netMargin,
    });
  }));

  api.get("/reports/staff", authenticate, asyncHandler(async (req, res) => {
    const now = new Date();
    let { start, end } = req.query;
    if (!start) start = isoFromDate(new Date(now.getTime() - 30 * 86400000));
    if (!end) end = isoFromDate(now);

    const match = { ...scopeQuery(req.user), created_at: { $gte: start, $lte: end } };
    const pipeline = [
      { $match: match },
      { $group: {
        _id: "$cashier_id",
        name: { $first: "$cashier_name" },
        orders: { $sum: 1 },
        revenue: { $sum: "$total" },
        items: { $sum: { $size: "$items" } },
      } },
    ];
    const raw = await db.collection("invoices").aggregate(pipeline).toArray();

    const out = [];
    const users = await db.collection("users").find({}).toArray();
    const byId = {};
    for (const u of users) byId[String(u._id)] = u;
    const seen = new Set();
    for (const r of raw) {
      const sid = r._id;
      if (!sid) continue;
      seen.add(sid);
      const u = byId[sid] || {};
      const target = u.sales_target || 0;
      const revenue = round2(r.revenue || 0);
      out.push({
        staff_id: sid,
        name: r.name || u.name,
        role: u.role,
        orders: r.orders || 0,
        revenue,
        items_sold: r.items || 0,
        avg_basket: r.orders ? round2(revenue / r.orders) : 0,
        target,
        attainment_percent: target ? round((revenue / target) * 100, 1) : 0,
      });
    }
    for (const u of users) {
      const sid = String(u._id);
      if (seen.has(sid)) continue;
      out.push({
        staff_id: sid,
        name: u.name,
        role: u.role,
        orders: 0,
        revenue: 0,
        items_sold: 0,
        avg_basket: 0,
        target: u.sales_target || 0,
        attainment_percent: 0,
      });
    }

    out.sort((a, b) => b.revenue - a.revenue);
    res.json({ range: { start, end }, staff: out });
  }));
};
