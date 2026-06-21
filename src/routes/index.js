// Registers every route on the shared /api router, mirroring the single
// APIRouter(prefix="/api") used in server.py. Order follows server.py.
const registrars = [
  require("./auth"),
  require("./customers"),
  require("./products"),
  require("./promotions"),
  require("./invoices"),
  require("./staff"),
  require("./analytics"),
  require("./suppliers"),
  require("./purchaseOrders"),
  require("./expenses"),
  require("./payroll"),
  require("./stores"),
  require("./transfers"),
  require("./attendance"),
  require("./payments"),
  require("./invoiceEmail"),
  require("./shifts"),
  require("./permissions"),
  require("./returns"),
  require("./inventory"),
  require("./chat"),
  require("./ai"),
];

module.exports = (api) => {
  for (const register of registrars) {
    register(api);
  }
};
