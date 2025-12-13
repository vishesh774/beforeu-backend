import CheckoutField, { ICheckoutField } from '../models/CheckoutField';

export interface CheckoutCalculationResult {
  itemTotal: number;
  breakdown: Array<{
    fieldName: string;
    fieldDisplayName: string;
    amount: number;
  }>;
  total: number;
}

/**
 * Calculate total amount using checkout config fields
 * @param itemTotal - Base item total (in rupees)
 * @param checkoutFields - Array of active checkout fields
 * @returns Calculation result with breakdown and total
 */
export async function calculateCheckoutTotal(
  itemTotal: number,
  checkoutFields?: ICheckoutField[]
): Promise<CheckoutCalculationResult> {
  // If no checkout fields provided, return itemTotal as-is
  if (!checkoutFields || checkoutFields.length === 0) {
    return {
      itemTotal,
      breakdown: [],
      total: itemTotal,
    };
  }

  // Sort fields by order
  const sortedFields = [...checkoutFields].sort((a, b) => a.order - b.order);

  let runningTotal = itemTotal;
  const breakdown: Array<{ fieldName: string; fieldDisplayName: string; amount: number }> = [];

  // Process checkout fields in order
  for (const field of sortedFields) {
    let amount = 0;

    if (field.chargeType === 'fixed') {
      amount = field.value;
    } else if (field.chargeType === 'percentage') {
      amount = (itemTotal * field.value) / 100;
    }

    // Add to breakdown
    breakdown.push({
      fieldName: field.fieldName,
      fieldDisplayName: field.fieldDisplayName,
      amount: amount,
    });

    // Update running total based on field name convention
    // If field name contains 'discount', subtract; otherwise add
    const isDiscount = field.fieldName.toLowerCase().includes('discount');

    if (isDiscount) {
      runningTotal -= amount;
    } else {
      runningTotal += amount;
    }
  }

  return {
    itemTotal,
    breakdown,
    total: runningTotal,
  };
}

/**
 * Get active checkout fields from database
 * @returns Array of active checkout fields sorted by order
 */
export async function getActiveCheckoutFields(): Promise<ICheckoutField[]> {
  const checkoutFields = await CheckoutField.find({ isActive: true })
    .sort({ order: 1 });
  return checkoutFields;
}

