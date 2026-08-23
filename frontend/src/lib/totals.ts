/**
 * Client-side totals.
 *
 * The server stays authoritative: every draft save round-trips through
 * `update_invoice`, which runs ERPNext's own `calculate_taxes_and_totals`. But a POS
 * has to show a correct total the instant a key is pressed, so this mirrors
 * ERPNext's arithmetic closely enough that the displayed figure and the saved
 * figure agree.
 *
 * Supported charge types: Actual, On Net Total, On Previous Row Amount, On Previous
 * Row Total, On Item Quantity — plus inclusive ("included_in_print_rate") rates,
 * which are backed out of the item rate the way ERPNext does it.
 */

import { money, round, toNumber } from "@/lib/format";
import type { CartItem } from "@/types";

export type ChargeType =
	| "Actual"
	| "On Net Total"
	| "On Previous Row Amount"
	| "On Previous Row Total"
	| "On Item Quantity";

export interface TaxRow {
	idx: number;
	charge_type: ChargeType;
	account_head: string;
	description: string;
	rate: number;
	tax_amount: number;
	total: number;
	row_id?: number | string;
	included_in_print_rate?: 0 | 1;
	/** Per-item tax split, keyed by cart row id — needed for item-level tax templates. */
	item_wise_tax_detail?: Record<string, [number, number]>;
}

export interface TotalsInput {
	items: CartItem[];
	taxes: TaxRow[];
	/** "Net Total" | "Grand Total" */
	applyDiscountOn: string;
	discountAmount: number;
	additionalDiscountPercentage: number;
	disableRoundedTotal: boolean;
}

export interface Totals {
	totalQty: number;
	/** Sum of line amounts before any invoice-level discount. */
	total: number;
	netTotal: number;
	itemDiscountTotal: number;
	discountAmount: number;
	totalTaxes: number;
	grandTotal: number;
	roundedTotal: number;
	roundingAdjustment: number;
	taxes: TaxRow[];
}

const EMPTY: Totals = {
	totalQty: 0,
	total: 0,
	netTotal: 0,
	itemDiscountTotal: 0,
	discountAmount: 0,
	totalTaxes: 0,
	grandTotal: 0,
	roundedTotal: 0,
	roundingAdjustment: 0,
	taxes: [],
};

export function lineAmount(item: CartItem): number {
	return money(toNumber(item.qty) * toNumber(item.rate));
}

/**
 * Strip inclusive tax out of gross line amounts.
 *
 * ERPNext divides each line by (1 + Σ inclusive rates) for the "On Net Total"
 * inclusive case, which is the only inclusive shape a POS realistically hits.
 */
function inclusiveNetFactor(taxes: TaxRow[]): number {
	const inclusiveRate = taxes
		.filter((tax) => tax.included_in_print_rate && tax.charge_type === "On Net Total")
		.reduce((sum, tax) => sum + toNumber(tax.rate), 0);
	return 1 + inclusiveRate / 100;
}

export function calculateTotals(input: TotalsInput): Totals {
	const { items, taxes, applyDiscountOn, disableRoundedTotal } = input;
	if (!items.length) return { ...EMPTY, taxes: [] };

	const factor = inclusiveNetFactor(taxes);

	let totalQty = 0;
	let gross = 0;
	let itemDiscountTotal = 0;

	const lines = items.map((item) => {
		const qty = toNumber(item.qty);
		const amount = lineAmount(item);
		totalQty += qty;
		gross += amount;
		itemDiscountTotal += money(toNumber(item.discount_amount) * qty);
		return { item, qty, amount, net: factor === 1 ? amount : money(amount / factor) };
	});

	const total = money(gross);
	// With inclusive tax the "net" is the tax-exclusive base; otherwise they match.
	let netTotal = money(lines.reduce((sum, line) => sum + line.net, 0));

	// ---- invoice-level discount -------------------------------------------
	let discountAmount = money(toNumber(input.discountAmount));
	const discountPercentage = toNumber(input.additionalDiscountPercentage);

	if (discountPercentage) {
		const base = applyDiscountOn === "Grand Total" ? null : netTotal;
		if (base !== null) discountAmount = money((base * discountPercentage) / 100);
	}

	const discountOnNet = applyDiscountOn !== "Grand Total";
	if (discountOnNet && discountAmount) {
		// Never give away more than is being sold. Typing 400 against a 180 basket used
		// to produce a negative grand total — a till proposing to pay the customer.
		discountAmount = money(Math.min(discountAmount, netTotal));
		netTotal = money(netTotal - discountAmount);
	}

	// ---- taxes -------------------------------------------------------------
	const computed: TaxRow[] = [];
	let runningTotal = netTotal;
	let totalTaxes = 0;

	taxes.forEach((tax, index) => {
		const rate = toNumber(tax.rate);
		let taxAmount = 0;

		switch (tax.charge_type) {
			case "Actual":
				taxAmount = money(toNumber(tax.tax_amount));
				break;
			case "On Net Total":
				taxAmount = money((netTotal * rate) / 100);
				break;
			case "On Previous Row Amount": {
				const previous = computed[referencedIndex(tax, index)];
				taxAmount = previous ? money((previous.tax_amount * rate) / 100) : 0;
				break;
			}
			case "On Previous Row Total": {
				const previous = computed[referencedIndex(tax, index)];
				const base = previous ? previous.total : netTotal;
				taxAmount = money((base * rate) / 100);
				break;
			}
			case "On Item Quantity":
				taxAmount = money(totalQty * rate);
				break;
			default:
				taxAmount = money(toNumber(tax.tax_amount));
		}

		// An inclusive row's value is already inside the item rate, so it must not be
		// added on top again — it is reported, not accumulated.
		if (!tax.included_in_print_rate) {
			runningTotal = money(runningTotal + taxAmount);
			totalTaxes = money(totalTaxes + taxAmount);
		}

		computed.push({ ...tax, tax_amount: taxAmount, total: runningTotal });
	});

	// ---- grand total -------------------------------------------------------
	let grandTotal = money(netTotal + totalTaxes);

	if (!discountOnNet && (discountAmount || discountPercentage)) {
		// Discount on Grand Total: the base only exists once taxes are in, so a
		// percentage is resolved here — even when no explicit amount was typed.
		if (discountPercentage) discountAmount = money((grandTotal * discountPercentage) / 100);
		// Capped for the same reason as the net-total branch above.
		discountAmount = money(Math.min(discountAmount, grandTotal));
		grandTotal = money(grandTotal - discountAmount);
	}

	const roundedTotal = disableRoundedTotal ? grandTotal : round(grandTotal, 0);
	const roundingAdjustment = disableRoundedTotal ? 0 : money(roundedTotal - grandTotal);

	return {
		totalQty: round(totalQty, 3),
		total,
		netTotal,
		itemDiscountTotal: money(itemDiscountTotal),
		discountAmount,
		totalTaxes,
		grandTotal,
		roundedTotal,
		roundingAdjustment,
		taxes: computed,
	};
}

/**
 * Resolve the row a "On Previous Row …" charge points at.
 *
 * `row_id` is 1-based in ERPNext; fall back to the immediately preceding row when
 * it is missing, which is what the UI implies when the field is left blank.
 */
function referencedIndex(tax: TaxRow, index: number): number {
	const rowId = toNumber(tax.row_id);
	return rowId > 0 ? rowId - 1 : index - 1;
}

/**
 * Recompute a line after any of qty / rate / discount changed.
 *
 * `discount_percentage` and `discount_amount` are two views of the same thing;
 * whichever the cashier last touched wins and the other is derived.
 */
export function applyLineDiscount(
	item: CartItem,
	source: "percentage" | "amount" | "rate",
): CartItem {
	const priceListRate = toNumber(item.price_list_rate);

	if (source === "percentage") {
		const percentage = clampPercentage(toNumber(item.discount_percentage));
		item.discount_percentage = percentage;
		item.discount_amount = money((priceListRate * percentage) / 100);
		item.rate = money(priceListRate - item.discount_amount);
	} else if (source === "amount") {
		const amount = Math.min(Math.max(toNumber(item.discount_amount), 0), priceListRate);
		item.discount_amount = money(amount);
		item.discount_percentage = priceListRate ? round((amount / priceListRate) * 100, 4) : 0;
		item.rate = money(priceListRate - item.discount_amount);
	} else {
		// The cashier typed a rate directly; express the gap as the discount.
		const rate = money(toNumber(item.rate));
		item.rate = rate;
		item.discount_amount = money(Math.max(priceListRate - rate, 0));
		item.discount_percentage = priceListRate
			? round((item.discount_amount / priceListRate) * 100, 4)
			: 0;
	}

	item.amount = lineAmount(item);
	return item;
}

function clampPercentage(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(Math.max(value, 0), 100);
}
