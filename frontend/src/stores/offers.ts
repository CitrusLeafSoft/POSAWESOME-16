/**
 * Offers and coupons.
 *
 * Holds the offer catalog for the profile, tracks which offers the cashier has
 * switched on, and re-runs the engine whenever the cart changes.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/lib/api";
import { evaluate, reconcile, type EligibleOffer } from "@/lib/offers";
import { toNumber } from "@/lib/format";
import type { Coupon, POSOffer } from "@/types";
import { useCartStore } from "./cart";
import { useCatalogStore } from "./catalog";
import { useSessionStore } from "./session";
import { useUiStore } from "./ui";

export const useOffersStore = defineStore("offers", () => {
	const session = useSessionStore();
	const cart = useCartStore();
	const catalog = useCatalogStore();
	const ui = useUiStore();

	/** Every offer configured for this profile. */
	const catalogOffers = ref<POSOffer[]>([]);
	/** Offers that currently qualify against the cart. */
	const eligible = ref<EligibleOffer[]>([]);
	/** row_ids the cashier has switched on (auto offers are added for them). */
	const enabled = ref<Set<string>>(new Set());
	/** Cashier's Give Product choice, per offer row_id. */
	const giveItemChoice = ref<Record<string, string>>({});

	const coupons = ref<Coupon[]>([]);
	const giftCoupons = ref<string[]>([]);

	/** An offer's invoice discount is standing aside for one the cashier typed. */
	const invoiceDiscountOverridden = computed(
		() =>
			cart.additionalDiscountSource === "manual" &&
			eligible.value.some(
				(offer) => offer.offer === "Grand Total" && enabled.value.has(offer.row_id),
			),
	);

	const availableCount = computed(() => eligible.value.length);
	const appliedCount = computed(() => cart.appliedOffers.length);
	/** Eligible but not yet switched on — what the "new offers" badge counts. */
	const pendingCount = computed(
		() => eligible.value.filter((offer) => !enabled.value.has(offer.row_id)).length,
	);

	async function load() {
		if (!session.profile) return;
		try {
			catalogOffers.value = ((await api.offers(session.profile.name)) as POSOffer[]) ?? [];
			// `auto` offers are on by default; the cashier can still switch them off.
			for (const offer of catalogOffers.value) {
				if (offer.auto) enabled.value.add(offer.name);
			}
		} catch {
			catalogOffers.value = [];
		}
	}

	/** Re-evaluate and re-apply. Called after any cart mutation. */
	function refresh() {
		if (!catalogOffers.value.length) return;

		// A credit note mirrors the invoice it reverses. Re-running promotions against
		// it changes the amount refunded — measured, a 10% offer turned a 100 refund
		// into 90 while the tender still said 100 — and the customer is owed what they
		// actually paid. Whatever the original invoice carried travels with it through
		// loadFromDoc; nothing new is evaluated.
		if (cart.isReturn) return;

		const context = {
			items: cart.items,
			total: cart.totals.total,
			coupons: coupons.value,
			findItem: (itemCode: string) => catalog.findByCode(itemCode),
		};

		const matched = evaluate(catalogOffers.value, context).map((offer) => ({
			...offer,
			give_item: giveItemChoice.value[offer.row_id] ?? offer.give_item,
		}));

		const previousPending = pendingCount.value;
		eligible.value = matched;

		const result = reconcile(matched, cart.appliedOffers, context, catalogOffers.value, enabled.value);

		// Only write back when something really moved. reconcile() always returns fresh
		// clones, so assigning unconditionally marked the cart dirty and re-triggered
		// every deep watcher on it for no reason — and made the loop above far easier
		// to fall into.
		if (linesChanged(cart.items, result.items)) cart.items = result.items;
		cart.appliedOffers = result.applied;

		if (result.grandTotalOfferName) {
			// Whichever way the offer is configured; setAdditionalDiscount keeps the two
			// mutually exclusive, so passing the mode through is enough.
			if (result.grandTotalDiscountAmount > 0) {
				cart.setAdditionalDiscount(result.grandTotalDiscountAmount, "amount", "offer");
			} else {
				cart.setAdditionalDiscount(result.grandTotalDiscountPercentage, "percentage", "offer");
			}
		}

		for (const title of result.loyaltyOffersApplied) {
			ui.success("Loyalty points earned", title);
		}

		// Nudge the cashier when something new becomes available.
		if (pendingCount.value > previousPending) {
			ui.notify({
				title: pendingCount.value === 1 ? "An offer is available" : `${pendingCount.value} offers available`,
				detail: "Open the Offers panel to apply them.",
				tone: "warning",
			});
		}
	}

	/** Cheap comparison of the fields the offer engine is allowed to move. */
	function linesChanged(before: typeof cart.items, after: typeof cart.items): boolean {
		if (before.length !== after.length) return true;
		for (let i = 0; i < before.length; i += 1) {
			const a = before[i];
			const b = after[i];
			if (
				a.posa_row_id !== b.posa_row_id ||
				a.item_code !== b.item_code ||
				a.qty !== b.qty ||
				a.rate !== b.rate ||
				a.discount_percentage !== b.discount_percentage ||
				a.discount_amount !== b.discount_amount ||
				a.is_free_item !== b.is_free_item ||
				a.posa_is_offer !== b.posa_is_offer ||
				a.posa_offers !== b.posa_offers
			) {
				return true;
			}
		}
		return false;
	}

	function toggle(rowId: string, on: boolean) {
		const next = new Set(enabled.value);
		if (on) next.add(rowId);
		else next.delete(rowId);
		enabled.value = next;
		refresh();
	}

	function chooseGiveItem(rowId: string, itemCode: string) {
		giveItemChoice.value = { ...giveItemChoice.value, [rowId]: itemCode };
		refresh();
	}

	/** Items a Give Product offer may hand over, for the picker. */
	function giveItemOptions(offer: POSOffer): string[] {
		if (offer.apply_type === "Item Code") return offer.apply_item_code ? [offer.apply_item_code] : [];
		if (offer.apply_type === "Item Group" && offer.apply_item_group) {
			return catalog.items
				.filter((item) => item.item_group === offer.apply_item_group)
				.map((item) => item.item_code);
		}
		return [];
	}

	async function applyCoupon(code: string) {
		if (!code.trim()) return;
		// Codes are matched case-insensitively server-side, so the duplicate check has
		// to be too — otherwise "save10" after "SAVE10" is added a second time.
		const typed = code.trim().toUpperCase();
		if (coupons.value.some((coupon) => (coupon.coupon_code ?? "").toUpperCase() === typed)) {
			ui.warn("That coupon is already on this sale");
			return;
		}
		try {
			// check_coupon_code answers { coupon: <POS Coupon doc>, msg }. The offer is a
			// field on that document, not a sibling of it — reading it as `result.pos_offer`
			// left every applied coupon with no offer attached, so the coupon reported
			// success and then unlocked nothing. couponSatisfied() matches on exactly this.
			const result = (await api.coupon({
				coupon: typed,
				customer: cart.customer,
				company: session.companyName,
			})) as {
				msg?: string;
				coupon?: {
					name?: string;
					coupon_code?: string;
					coupon_type?: string;
					pos_offer?: string;
					customer?: string;
				};
			} | null;

			const applied = result?.coupon;
			if (!applied) {
				ui.fail("Coupon not valid", result?.msg ?? "That code was not accepted.");
				return;
			}

			// The server matches case-insensitively; store what it actually resolved to so
			// removing the coupon later compares against the same string.
			const resolvedCode = applied.coupon_code ?? typed;
			const offerName = applied.pos_offer;

			// A full POS Coupon Detail row. Sending only the code and the offer left
			// `coupon` empty, and the invoice refused to save at all — "Value missing
			// for: Coupon". It is also what the server increments the used-count by, and
			// `customer` is what the once-per-customer rule counts on.
			coupons.value = [
				...coupons.value,
				{
					coupon: applied.name,
					coupon_code: resolvedCode,
					pos_offer: offerName,
					type: applied.coupon_type,
					customer: applied.customer || cart.customer || undefined,
					applied: 1,
				},
			];
			cart.appliedCoupons = coupons.value;
			// A coupon can unlock a coupon-gated offer, so switch it on immediately.
			if (offerName) toggle(offerName, true);
			else refresh();
			ui.success("Coupon applied", resolvedCode);
		} catch (error) {
			ui.fail("Coupon not valid", error instanceof Error ? error.message : String(error));
		}
	}

	function removeCoupon(code: string) {
		coupons.value = coupons.value.filter((coupon) => coupon.coupon_code !== code);
		cart.appliedCoupons = coupons.value;
		refresh();
	}

	async function loadGiftCoupons() {
		if (!cart.customer || !session.profile?.posa_fetch_coupon) return;
		try {
			giftCoupons.value = ((await api.activeGiftCoupons(cart.customer, session.companyName)) as string[]) ?? [];
		} catch {
			giftCoupons.value = [];
		}
	}

	/** Loyalty points the customer could spend on this sale. */
	const redeemableLoyalty = computed(() => {
		const info = cart.customerInfo;
		if (!info?.loyalty_points || !info.conversion_factor) return { points: 0, amount: 0 };
		const points = toNumber(info.loyalty_points);
		return { points, amount: points * toNumber(info.conversion_factor) };
	});

	function reset() {
		eligible.value = [];
		coupons.value = [];
		giftCoupons.value = [];
		giveItemChoice.value = {};
		enabled.value = new Set(catalogOffers.value.filter((offer) => offer.auto).map((offer) => offer.name));
	}

	return {
		catalogOffers,
		eligible,
		enabled,
		coupons,
		giftCoupons,
		availableCount,
		invoiceDiscountOverridden,
		appliedCount,
		pendingCount,
		redeemableLoyalty,
		load,
		refresh,
		toggle,
		chooseGiveItem,
		giveItemOptions,
		applyCoupon,
		removeCoupon,
		loadGiftCoupons,
		reset,
	};
});
