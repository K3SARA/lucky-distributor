import { calculateTotals, DEFAULT_TAX_RATE } from "@lucky/shared";

export const seedState = {
  settings: {
    businessName: "Lucky Distributor POS",
    currency: "LKR",
    taxRate: DEFAULT_TAX_RATE
  },
  products: [
    { id: "p-001", name: "Lucky chocolate kalkiri", size: "250 ml", sku: "LCK250", category: "Kalkiri", price: 120, billingPrice: 110, mrp: 120, stock: 100 },
    { id: "p-002", name: "Lucky vanilla kalkiri", size: "250 ml", sku: "LVK250", category: "Kalkiri", price: 120, billingPrice: 110, mrp: 120, stock: 100 },
    { id: "p-003", name: "Lucky falooda kalkiri", size: "250 ml", sku: "LFK250", category: "Kalkiri", price: 120, billingPrice: 110, mrp: 120, stock: 100 },
    { id: "p-004", name: "Lucky mango kalkiri", size: "250 ml", sku: "LMK250", category: "Kalkiri", price: 120, billingPrice: 110, mrp: 120, stock: 100 },
    { id: "p-005", name: "Lucky cardamom kalkiri", size: "250 ml", sku: "LCARDK250", category: "Kalkiri", price: 120, billingPrice: 110, mrp: 120, stock: 100 },
    { id: "p-006", name: "Lucky chocolate kalkiri", size: "1800 ml", sku: "LCK1800", category: "Kalkiri", price: 700, billingPrice: 650, mrp: 700, stock: 100 },
    { id: "p-007", name: "Lucky vanilla kalkiri", size: "180 ml", sku: "LVK180", category: "Kalkiri", price: 90, billingPrice: 82, mrp: 90, stock: 100 },
    { id: "p-008", name: "Lucky mixed fruit", size: "200 ml", sku: "LMF200", category: "Juice", price: 100, billingPrice: 90, mrp: 100, stock: 100 },
    { id: "p-009", name: "Lucky mango", size: "200 ml", sku: "LM200", category: "Juice", price: 100, billingPrice: 90, mrp: 100, stock: 100 },
    { id: "p-010", name: "Lucky aloe vera", size: "200 ml", sku: "LAV200", category: "Juice", price: 100, billingPrice: 90, mrp: 100, stock: 100 }
  ],
  sales: [],
  returns: [],
  stockMovements: [],
  customers: [],
  staff: []
};

export const enrichSale = (sale) => {
  const totals = calculateTotals({
    lines: sale.lines,
    taxRate: sale.taxRate ?? DEFAULT_TAX_RATE,
    discount: sale.discount ?? 0
  });

  return {
    ...sale,
    ...totals,
    paidAmount: sale.paidAmount ?? totals.total,
    dueAmount: Number(Math.max(0, totals.total - (sale.paidAmount ?? totals.total)).toFixed(2))
  };
};


