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
  checkoutFields?: ICheckoutField[],
  discountOptions?: { amount: number; label: string }
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
  let discountedItemTotal = itemTotal;
  const breakdown: Array<{ fieldName: string; fieldDisplayName: string; amount: number }> = [];

  // Apply discount first if provided
  if (discountOptions && discountOptions.amount > 0) {
    breakdown.push({
      fieldName: 'discount',
      fieldDisplayName: discountOptions.label || 'Discount',
      amount: discountOptions.amount,
    });
    discountedItemTotal = Math.max(0, itemTotal - discountOptions.amount);
    runningTotal = discountedItemTotal;
  }

  // Process checkout fields in order
  for (const field of sortedFields) {
    let amount = 0;

    if (field.chargeType === 'fixed') {
      amount = field.value;
    } else if (field.chargeType === 'percentage') {
      // Calculate percentage on the discounted item total
      amount = (discountedItemTotal * field.value) / 100;
    }

    // Add to breakdown
    breakdown.push({
      fieldName: field.fieldName,
      fieldDisplayName: field.fieldDisplayName,
      amount: amount,
    });

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

