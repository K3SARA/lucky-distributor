import { calculateTotals, DEFAULT_TAX_RATE } from "@pepsi/shared";

export const seedState = {
  settings: {
    businessName: "Pepsi Distributor POS",
    currency: "LKR",
    taxRate: DEFAULT_TAX_RATE
  },
  products: [
    { id: "p-001", name: "Pepsi 500ml", sku: "PEP500", category: "Soft Drinks", price: 1.5, billingPrice: 1.2, mrp: 1.5, stock: 420 },
    { id: "p-002", name: "Pepsi 1.5L", sku: "PEP1500", category: "Soft Drinks", price: 2.9, billingPrice: 2.35, mrp: 2.9, stock: 280 },
    { id: "p-003", name: "7UP 500ml", sku: "7UP500", category: "Soft Drinks", price: 1.45, billingPrice: 1.15, mrp: 1.45, stock: 300 },
    { id: "p-004", name: "Mirinda Orange 500ml", sku: "MIR500", category: "Soft Drinks", price: 1.4, billingPrice: 1.1, mrp: 1.4, stock: 250 },
    { id: "p-005", name: "Aquafina 1L", sku: "AQ1000", category: "Water", price: 1.1, billingPrice: 0.85, mrp: 1.1, stock: 350 }
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


