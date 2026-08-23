/**
 * POS Offer engine.
 *
 * Two phases, deliberately kept apart:
 *
 *   evaluate() — pure. Given the offer catalog and the current cart, work out which
 *                offers qualify and which rows each one covers. No mutation.
 *   reconcile() — impure. Diff the qualifying set against what is already applied,
 *                 then add and retract the difference.
 *
 * Splitting them this way is what makes the "Give Product" replace variants
 * tractable: eligibility never has to reason about lines the engine itself added.
 */

import { money, round, toNumber } from "@/lib/format";
import { applyLineDiscount, lineAmount } from "@/lib/totals";
import { uid } from "@/lib/uid";
import type { AppliedOffer, CartItem, Coupon, Item, POSOffer } from "@/types";

export interface EligibleOffer extends POSOffer {
	/** Cart row ids the offer covers. */
	items: string[];
	/** Item that will be handed over, for Give Product offers. */
	give_item?: string;
	row_id: string;
}

export interface OfferContext {
	items: CartItem[];
	/** Cart total before invoice-level discount — what Transaction offers test. */
	total: number;
	coupons: Coupon[];
	/** Catalog lookup, needed to build a Give Product line. */
	findItem: (itemCode: string) => Item | undefined;
}

/* -------------------------------------------------------------------------- */
/* Phase 1 — eligibility                                                       */
/* -------------------------------------------------------------------------- */

export function evaluate(offers: POSOffer[], context: OfferContext): EligibleOffer[] {
	const eligible: EligibleOffer[] = [];

	for (const offer of offers) {
		if (!couponSatisfied(offer, context.coupons)) continue;

		let resolved: EligibleOffer | null = null;
		switch (offer.apply_on) {
			case "Item Code":
				resolved = matchByItemCode(offer, context);
				break;
			case "Item Group":
				resolved = matchByField(offer, context, "item_group", offer.item_group);
				break;
			case "Brand":
				resolved = matchByField(offer, context, "brand", offer.brand);
				break;
			case "Transaction":
				resolved = matchTransaction(offer, context);
				break;
		}

		if (resolved) eligible.push(withGiveItem(resolved, context));
	}

	return eligible;
}

/** A coupon-gated offer only qualifies when its coupon is on the invoice. */
function couponSatisfied(offer: POSOffer, coupons: Coupon[]): boolean {
	if (!offer.coupon_based) return true;
	return coupons.some((coupon) => coupon.pos_offer === offer.name);
}

/** Lines the engine created must never re-trigger the offer that created them. */
function isCandidate(item: CartItem): boolean {
	return !item.posa_is_offer;
}

function stockQty(item: CartItem): number {
	return toNumber(item.qty) * (toNumber(item.conversion_factor) || 1);
}

function matchByItemCode(offer: POSOffer, context: OfferContext): EligibleOffer | null {
	for (const item of context.items) {
		if (!isCandidate(item) || item.item_code !== offer.item) continue;
		// An Item Price offer must not stack on a line it has already discounted.
		if (offer.offer === "Item Price" && item.posa_offer_applied && !alreadyCarries(item, offer)) continue;

		const quantity = stockQty(item);
		if (!withinBounds(offer, quantity, quantity * toNumber(item.price_list_rate))) continue;

		return { ...offer, items: [item.posa_row_id], row_id: offer.name };
	}
	return null;
}

function matchByField(
	offer: POSOffer,
	context: OfferContext,
	field: "item_group" | "brand",
	expected?: string,
): EligibleOffer | null {
	if (!expected) return null;

	const rows: string[] = [];
	let totalQty = 0;
	let totalAmount = 0;

	for (const item of context.items) {
		if (!isCandidate(item)) continue;
		if ((item as unknown as Record<string, unknown>)[field] !== expected) continue;
		if (offer.offer === "Item Price" && item.posa_offer_applied && !alreadyCarries(item, offer)) continue;

		const quantity = stockQty(item);
		totalQty += quantity;
		totalAmount += quantity * toNumber(item.price_list_rate);
		rows.push(item.posa_row_id);
	}

	if (!rows.length) return null;
	if (!withinBounds(offer, totalQty, totalAmount)) return null;
	return { ...offer, items: rows, row_id: offer.name };
}

function matchTransaction(offer: POSOffer, context: OfferContext): EligibleOffer | null {
	const totalQty = context.items
		.filter((item) => isCandidate(item) && !item.posa_is_replace)
		.reduce((sum, item) => sum + stockQty(item), 0);

	if (!totalQty && !context.total) return null;
	if (!withinBounds(offer, totalQty, context.total)) return null;

	return { ...offer, items: context.items.map((item) => item.posa_row_id), row_id: offer.name };
}

/**
 * Qty/amount gates.
 *
 * Every gate the offer actually sets must hold; unset gates are ignored. Note
 * `min_qty` of 0 is meaningful (matches everything) and so is tested explicitly.
 */
function withinBounds(offer: POSOffer, quantity: number, amount: number): boolean {
	const checks: boolean[] = [];
	if (offer.min_qty !== undefined && offer.min_qty !== null) checks.push(quantity >= toNumber(offer.min_qty));
	if (toNumber(offer.max_qty) > 0) checks.push(quantity <= toNumber(offer.max_qty));
	if (toNumber(offer.min_amt) > 0) checks.push(amount >= toNumber(offer.min_amt));
	if (toNumber(offer.max_amt) > 0) checks.push(amount <= toNumber(offer.max_amt));
	return checks.every(Boolean);
}

function alreadyCarries(item: CartItem, offer: POSOffer): boolean {
	return parseOfferIds(item.posa_offers).includes(offer.name);
}

/**
 * Decide which item a Give Product offer hands over.
 *
 * Order of precedence: an explicit replace rule, then whatever the cashier picked,
 * then the offer's own apply_item_code. Only the Item Group case leaves the choice
 * open, and the UI fills it from that group's items.
 */
function withGiveItem(offer: EligibleOffer, context: OfferContext): EligibleOffer {
	if (offer.offer !== "Give Product") return offer;

	if (offer.apply_on === "Item Code" && offer.apply_type === "Item Code" && offer.replace_item) {
		return { ...offer, give_item: offer.item };
	}
	if (offer.apply_on === "Item Group" && offer.apply_type === "Item Group" && offer.replace_cheapest_item) {
		const cheapest = cheapestOf(offer.items, context.items);
		return cheapest ? { ...offer, give_item: cheapest.item_code } : offer;
	}
	if (offer.give_item) return offer;
	if (offer.apply_type === "Item Code" && offer.apply_item_code) {
		return { ...offer, give_item: offer.apply_item_code };
	}
	return offer;
}

function cheapestOf(rowIds: string[], items: CartItem[]): CartItem | undefined {
	return items
		.filter((item) => rowIds.includes(item.posa_row_id) && !item.posa_is_replace && !item.posa_is_offer)
		.reduce<CartItem | undefined>(
			(cheapest, item) =>
				!cheapest || toNumber(item.price_list_rate) < toNumber(cheapest.price_list_rate) ? item : cheapest,
			undefined,
		);
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — application                                                       */
/* -------------------------------------------------------------------------- */

export interface ReconcileResult {
	items: CartItem[];
	applied: AppliedOffer[];
	/** Invoice-level discount owed to a Grand Total offer, if any. */
	grandTotalDiscountPercentage: number;
	/** A Grand Total offer can be a flat amount instead of a percentage. */
	grandTotalDiscountAmount: number;
	grandTotalOfferName: string | null;
	/** Loyalty offers that fired, for the operator to see. */
	loyaltyOffersApplied: string[];
}

/**
 * Apply the offers that are switched on, retract the rest.
 *
 * `eligible` is everything that *could* apply; `enabled` is the subset the cashier
 * ticked (offers marked `auto` are ticked on their behalf). An offer that stops
 * being eligible is retracted whether or not it is still ticked.
 */
export function reconcile(
	eligible: EligibleOffer[],
	current: AppliedOffer[],
	context: OfferContext,
	catalog: POSOffer[],
	enabled: Set<string>,
): ReconcileResult {
	let items = context.items.map((item) => ({ ...item }));
	const applied: AppliedOffer[] = [];
	const loyaltyOffersApplied: string[] = [];
	let grandTotalDiscountPercentage = 0;
	let grandTotalDiscountAmount = 0;
	let grandTotalOfferName: string | null = null;

	const eligibleByRow = new Map(eligible.map((offer) => [offer.row_id, offer]));

	// --- retract offers that no longer qualify, or were switched off -------
	for (const existing of current) {
		if (eligibleByRow.has(existing.row_id) && enabled.has(existing.row_id)) continue;
		items = retract(existing, items, catalog);
	}

	// --- apply / refresh the qualifying, switched-on set --------------------
	for (const offer of eligible) {
		if (!enabled.has(offer.row_id)) continue;
		const existing = current.find((entry) => entry.row_id === offer.row_id);

		switch (offer.offer) {
			case "Item Price":
				items = applyItemPrice(offer, items);
				break;

			case "Grand Total": {
				// A Grand Total offer is configured either way round. Only the percentage
				// was honoured before, so an offer set up as a flat "50 off" qualified,
				// reported itself applied, and discounted nothing.
				if (grandTotalOfferName) break;

				const percentage = toNumber(offer.discount_percentage);
				const amount = toNumber(offer.discount_amount);

				if (offer.discount_type === "Discount Amount" || (!percentage && amount > 0)) {
					if (amount > 0) {
						// Never give away more than the sale is worth.
						grandTotalDiscountAmount = Math.min(amount, toNumber(context.total));
						grandTotalOfferName = offer.name;
					}
				} else if (percentage > 0 && percentage <= 100) {
					grandTotalDiscountPercentage = percentage;
					grandTotalOfferName = offer.name;
				}
				break;
			}

			case "Give Product":
				if (!existing?.give_item) items = applyGiveProduct(offer, items, context);
				break;

			case "Loyalty Point":
				loyaltyOffersApplied.push(offer.title || offer.name);
				break;
		}

		const record: AppliedOffer = {
			row_id: offer.row_id,
			offer_name: offer.name,
			offer: offer.offer,
			apply_on: offer.apply_on,
			items: JSON.stringify(offer.items),
			item: offer.item,
			give_item: offer.give_item ?? existing?.give_item,
			applied: 1,
			offer_applied: 1,
			coupon: (offer as { coupon?: string }).coupon,
		};
		applied.push(record);
		items = tagItems(record, offer.items, items);
	}

	return {
		items,
		applied,
		grandTotalDiscountPercentage,
		grandTotalDiscountAmount,
		grandTotalOfferName,
		loyaltyOffersApplied,
	};
}

function applyItemPrice(offer: EligibleOffer, items: CartItem[]): CartItem[] {
	return items.map((item) => {
		if (!offer.items.includes(item.posa_row_id)) return item;
		if (parseOfferIds(item.posa_offers).includes(offer.row_id)) return item;

		const next = { ...item };
		if (offer.discount_type === "Rate") {
			next.rate = money(toNumber(offer.rate));
			applyLineDiscount(next, "rate");
		} else if (offer.discount_type === "Discount Percentage") {
			next.discount_percentage = round(next.discount_percentage + toNumber(offer.discount_percentage), 4);
			applyLineDiscount(next, "percentage");
		} else if (offer.discount_type === "Discount Amount") {
			next.discount_amount = money(next.discount_amount + toNumber(offer.discount_amount));
			applyLineDiscount(next, "amount");
		}
		next.posa_offer_applied = 1;
		return next;
	});
}

/**
 * Add the free/discounted line a Give Product offer promises.
 *
 * The two "replace" variants take the given quantity out of an existing line
 * instead of adding on top: replace_item consumes the triggering line,
 * replace_cheapest_item consumes the cheapest qualifying line.
 */
function applyGiveProduct(offer: EligibleOffer, items: CartItem[], context: OfferContext): CartItem[] {
	const giveCode = offer.give_item ?? offer.apply_item_code ?? offer.item;
	if (!giveCode) return items;

	const source = context.findItem(giveCode);
	if (!source) return items;

	const giveQty = toNumber(offer.given_qty) || 1;
	const freeLine = buildGiveLine(offer, source, giveQty);

	const replacing =
		(offer.apply_on === "Item Code" && offer.apply_type === "Item Code" && offer.replace_item) ||
		(offer.apply_on === "Item Group" && offer.apply_type === "Item Group" && offer.replace_cheapest_item);

	if (!replacing) return [freeLine, ...items];

	const baseLine = offer.replace_cheapest_item
		? items.find((item) => offer.items.includes(item.posa_row_id) && item.item_code === giveCode)
		: items.find((item) => item.posa_row_id === offer.items[0]);

	if (!baseLine) return [freeLine, ...items];

	// A replaced line is not "free stock added" — it is the same stock repriced.
	freeLine.posa_is_offer = 0;
	freeLine.posa_is_replace = baseLine.posa_row_id;

	const remaining = round(baseLine.qty - giveQty, 3);
	if (remaining <= 0) {
		// The offer swallows the whole line; take over its identity.
		freeLine.qty = baseLine.qty;
		freeLine.amount = lineAmount(freeLine);
		freeLine.posa_row_id = baseLine.posa_row_id;
		freeLine.posa_is_replace = baseLine.posa_row_id;
		return [freeLine, ...items.filter((item) => item.posa_row_id !== baseLine.posa_row_id)];
	}

	const trimmed = items.map((item) =>
		item.posa_row_id === baseLine.posa_row_id
			? { ...item, qty: remaining, amount: lineAmount({ ...item, qty: remaining }) }
			: item,
	);
	return [freeLine, ...trimmed];
}

function buildGiveLine(offer: EligibleOffer, source: Item, giveQty: number): CartItem {
	const isFree =
		(offer.discount_type === "Rate" && !toNumber(offer.rate)) ||
		(offer.discount_type === "Discount Percentage" && toNumber(offer.discount_percentage) === 0);

	const line: CartItem = {
		posa_row_id: uid("row"),
		item_code: source.item_code,
		item_name: source.item_name,
		description: source.description,
		image: source.image,
		item_group: source.item_group,
		stock_uom: source.stock_uom,
		uom: source.stock_uom,
		conversion_factor: 1,
		qty: giveQty,
		rate: offer.discount_type === "Rate" ? money(toNumber(offer.rate)) : money(toNumber(source.rate)),
		price_list_rate: isFree ? 0 : money(toNumber(source.rate)),
		amount: 0,
		discount_percentage: offer.discount_type === "Discount Percentage" ? toNumber(offer.discount_percentage) : 0,
		discount_amount: offer.discount_type === "Discount Amount" ? money(toNumber(offer.discount_amount)) : 0,
		warehouse: "",
		is_stock_item: source.is_stock_item,
		actual_qty: toNumber(source.actual_qty),
		has_batch_no: source.has_batch_no,
		has_serial_no: source.has_serial_no,
		batch_no: null,
		serial_no: null,
		use_serial_batch_fields: source.has_batch_no || source.has_serial_no ? 1 : 0,
		batch_no_data: source.batch_no_data ?? [],
		serial_no_data: source.serial_no_data ?? [],
		item_uoms: source.item_uoms ?? [{ uom: source.stock_uom, conversion_factor: 1 }],
		is_free_item: isFree ? 1 : 0,
		posa_offers: JSON.stringify([]),
		posa_offer_applied: 0,
		posa_is_offer: 1,
		posa_is_replace: null,
		posa_notes: "",
	};

	if (offer.discount_type === "Discount Percentage") applyLineDiscount(line, "percentage");
	else if (offer.discount_type === "Discount Amount") applyLineDiscount(line, "amount");
	else line.amount = lineAmount(line);

	return line;
}

/** Undo an offer that stopped qualifying. */
function retract(existing: AppliedOffer, items: CartItem[], catalog: POSOffer[]): CartItem[] {
	const original = catalog.find((offer) => offer.name === existing.offer_name);

	if (existing.offer === "Give Product") {
		items = items.filter((item) => !(item.posa_is_offer && item.item_code === existing.give_item));
	}

	if (existing.offer === "Item Price" && original) {
		items = items.map((item) => {
			if (!parseOfferIds(item.posa_offers).includes(existing.row_id)) return item;
			const next = { ...item };
			if (original.discount_type === "Rate") {
				next.rate = next.price_list_rate;
				applyLineDiscount(next, "rate");
			} else if (original.discount_type === "Discount Percentage") {
				next.discount_percentage = Math.max(
					round(next.discount_percentage - toNumber(original.discount_percentage), 4),
					0,
				);
				applyLineDiscount(next, "percentage");
			} else if (original.discount_type === "Discount Amount") {
				next.discount_amount = Math.max(money(next.discount_amount - toNumber(original.discount_amount)), 0);
				applyLineDiscount(next, "amount");
			}
			if (!next.discount_percentage && !next.discount_amount) next.posa_offer_applied = 0;
			return next;
		});
	}

	return untagItems(existing.row_id, items);
}

/* -------------------------------------------------------------------------- */
/* Row-id bookkeeping                                                          */
/* -------------------------------------------------------------------------- */
// `posa_offers` is a Small Text on the server, so it travels as a JSON array of
// offer row ids. These helpers keep the parsing in one place.

export function parseOfferIds(value: unknown): string[] {
	if (Array.isArray(value)) return value as string[];
	if (typeof value !== "string" || !value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function tagItems(offer: AppliedOffer, rowIds: string[], items: CartItem[]): CartItem[] {
	return items.map((item) => {
		if (!rowIds.includes(item.posa_row_id)) return item;
		const ids = parseOfferIds(item.posa_offers);
		if (ids.includes(offer.row_id)) return item;
		return { ...item, posa_offers: JSON.stringify([...ids, offer.row_id]) };
	});
}

function untagItems(rowId: string, items: CartItem[]): CartItem[] {
	return items.map((item) => {
		const ids = parseOfferIds(item.posa_offers);
		if (!ids.includes(rowId)) return item;
		return { ...item, posa_offers: JSON.stringify(ids.filter((id) => id !== rowId)) };
	});
}
