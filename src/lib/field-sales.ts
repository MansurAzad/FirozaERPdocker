export function fieldSalesRemainingQty(
  issued: number,
  returned: number,
  damaged: number,
  sold: number,
) {
  return issued - returned - damaged - sold;
}

export function matchesFieldSalesImei(
  imei: { imei1: string; imei2: string | null; variant_id: string },
  code: string,
  variantId: string,
) {
  const scanned = code.trim();
  return (
    scanned.length > 0 &&
    imei.variant_id === variantId &&
    (imei.imei1 === scanned || imei.imei2 === scanned)
  );
}

export function fieldSalesReturnCountMatches(remaining: number, good: number, damaged: number) {
  return (
    Number.isInteger(remaining) &&
    remaining >= 0 &&
    Number.isInteger(good) &&
    Number.isInteger(damaged) &&
    good >= 0 &&
    damaged >= 0 &&
    good + damaged === remaining
  );
}
