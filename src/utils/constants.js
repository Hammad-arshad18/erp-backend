// Currencies (40+)
const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { code: "SAR", symbol: "﷼", name: "Saudi Riyal" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "MXN", symbol: "Mex$", name: "Mexican Peso" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
  { code: "RUB", symbol: "₽", name: "Russian Ruble" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira" },
  { code: "KRW", symbol: "₩", name: "South Korean Won" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
  { code: "THB", symbol: "฿", name: "Thai Baht" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso" },
  { code: "VND", symbol: "₫", name: "Vietnamese Dong" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "TWD", symbol: "NT$", name: "Taiwan Dollar" },
  { code: "ILS", symbol: "₪", name: "Israeli Shekel" },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "DKK", symbol: "kr", name: "Danish Krone" },
  { code: "PLN", symbol: "zł", name: "Polish Zloty" },
  { code: "CZK", symbol: "Kč", name: "Czech Koruna" },
  { code: "HUF", symbol: "Ft", name: "Hungarian Forint" },
  { code: "RON", symbol: "lei", name: "Romanian Leu" },
  { code: "EGP", symbol: "E£", name: "Egyptian Pound" },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira" },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling" },
  { code: "PKR", symbol: "₨", name: "Pakistani Rupee" },
  { code: "BDT", symbol: "৳", name: "Bangladeshi Taka" },
  { code: "LKR", symbol: "Rs", name: "Sri Lankan Rupee" },
  { code: "NPR", symbol: "₨", name: "Nepali Rupee" },
  { code: "ARS", symbol: "$", name: "Argentine Peso" },
  { code: "CLP", symbol: "$", name: "Chilean Peso" },
  { code: "COP", symbol: "$", name: "Colombian Peso" },
  { code: "PEN", symbol: "S/", name: "Peruvian Sol" },
];

function currencySymbolFor(code) {
  for (const c of CURRENCIES) {
    if (c.code === code) return c.symbol;
  }
  return code;
}

// Plans
const PLAN_MODULES = {
  basic: ["pos", "invoices", "customers", "inventory", "promotions", "sales_report"],
  pro: [
    "pos", "invoices", "customers", "inventory", "promotions", "sales_report",
    "suppliers", "purchase_orders", "expenses", "pnl", "staff_kpis", "salary",
  ],
  enterprise: [
    "pos", "invoices", "customers", "inventory", "promotions", "sales_report",
    "suppliers", "purchase_orders", "expenses", "pnl", "staff_kpis", "salary",
    "transfers", "attendance", "schedule",
  ],
};

const PLANS = [
  { id: "basic", name: "Basic", modules: PLAN_MODULES.basic },
  { id: "pro", name: "Pro", modules: PLAN_MODULES.pro },
  { id: "enterprise", name: "Enterprise", modules: PLAN_MODULES.enterprise },
];

// All permission keys available in the system
const ALL_PERMISSIONS = [
  "view_pos", "manage_inventory", "manage_customers", "manage_promotions",
  "manage_suppliers", "manage_purchase_orders", "manage_expenses",
  "view_reports", "manage_attendance", "manage_payroll", "void_invoices",
  "manage_stores", "manage_transfers", "manage_staff",
];

module.exports = {
  CURRENCIES,
  currencySymbolFor,
  PLAN_MODULES,
  PLANS,
  ALL_PERMISSIONS,
};
