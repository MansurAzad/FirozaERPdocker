export type SaleExceptionType = "minimum_price" | "discount_limit" | "credit_limit";

export function getSaleExceptionTypes(input: {
  lines: { price: number; minPrice: number }[];
  subtotal: number;
  discount: number;
  due: number;
  customerDue?: number | null;
  creditLimit?: number | null;
}): SaleExceptionType[] {
  const exceptions = new Set<SaleExceptionType>();

  if (input.lines.some((line) => line.price < line.minPrice)) {
    exceptions.add("minimum_price");
  }
  if (input.discount > 0 && input.subtotal > 0 && input.discount / input.subtotal > 0.1) {
    exceptions.add("discount_limit");
  }
  if (input.due > 0 && (input.customerDue ?? 0) + input.due > (input.creditLimit ?? 0)) {
    exceptions.add("credit_limit");
  }

  return [...exceptions];
}
