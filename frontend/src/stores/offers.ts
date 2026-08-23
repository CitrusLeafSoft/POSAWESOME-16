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

		cart.items = result.items;
		cart.appliedOffers = result.applied;

		if (result.grandTotalOfferName) {
			cart.setAdditionalDiscount(result.grandTotalDiscountPercentage, "percentage");
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
		if (coupons.value.some((coupon) => coupon.coupon_code === code)) {
			ui.warn("That coupon is already on this sale");
			return;
		}
		try {
			const result = (await api.coupon({
				coupon: code,
				customer: cart.customer,
				company: session.companyName,
			})) as { msg?: string; coupon?: string; pos_offer?: string } | null;

			if (!result?.coupon) {
				ui.fail("Coupon not valid", result?.msg ?? "That code was not accepted.");
				return;
			}

			coupons.value = [
				...coupons.value,
				{ coupon_code: code, pos_offer: result.pos_offer, applied: 1 },
			];
			cart.appliedCoupons = coupons.value;
			// A coupon can unlock a coupon-gated offer, so switch it on immediately.
			if (result.pos_offer) toggle(result.pos_offer, true);
			else refresh();
			ui.success("Coupon applied", code);
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
