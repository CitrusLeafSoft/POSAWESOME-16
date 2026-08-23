<script setup lang="ts">
/**
 * The selling screen, laid out the way POS Awesome always was: a 5/12 column on
 * the left that swaps between items, offers, coupons and payment, and a 7/12
 * column on the right holding the invoice.
 *
 * The invoice never leaves the screen — a cashier tendering cash still needs to
 * see what they are charging for, which is why payment replaces the item grid
 * rather than the cart.
 */
import { onMounted, onUnmounted, watch } from "vue";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore } from "@/stores/catalog";
import { useOffersStore } from "@/stores/offers";
import { usePaymentsStore } from "@/stores/payments";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import { registerHotkeys } from "@/lib/hotkeys";
import CatalogPanel from "@/components/catalog/CatalogPanel.vue";
import CartPanel from "@/components/cart/CartPanel.vue";
import PaymentPanel from "@/components/payment/PaymentPanel.vue";
import OffersPanel from "@/components/payment/OffersPanel.vue";
import CouponsPanel from "@/components/payment/CouponsPanel.vue";
import ModalHost from "@/components/layout/ModalHost.vue";

const cart = useCartStore();
const catalog = useCatalogStore();
const offers = useOffersStore();
const payments = usePaymentsStore();
const session = useSessionStore();
const ui = useUiStore();

onMounted(async () => {
	if (!cart.customer && session.profile?.customer) cart.customer = session.profile.customer;
	payments.build();
	await offers.load();
});

// Offers depend on the cart, so re-evaluate whenever it settles.
//
// An ARRAY OF GETTERS, not a getter returning an array. Vue compares the former
// element by element; the latter it compares by identity, and a fresh array literal
// is never identical to the last one. Since offers.refresh() reassigns cart.items —
// a dependency of this very watcher — the array form re-fired itself on every pass
// and wedged the render loop after ~200 rounds. Every click after that did nothing.
watch(
	[() => cart.items.length, () => cart.totals.total],
	() => offers.refresh(),
);

async function toPayment() {
	if (cart.isEmpty || !cart.customer) {
		ui.warn(cart.isEmpty ? "The cart is empty" : "Pick a customer first");
		return;
	}
	// Save first so taxes and discounts are settled before amounts are tendered —
	// tendering against a total the server is about to change is how "Pay" ends
	// up rejecting every sale.
	if (cart.dirty) {
		try {
			await cart.saveDraft();
		} catch {
			// A failed save surfaces its own toast at submit time.
		}
	}
	payments.build();
	payments.tenderExact();
	ui.setWorkspace("payment");
}

const stop = registerHotkeys([
	{ combo: "F8", label: "Go to payment", group: "Sale", handler: toPayment },
	{
		combo: "F4",
		label: "Show offers",
		group: "Sale",
		handler: () => ui.setWorkspace(ui.workspace === "offers" ? "catalog" : "offers"),
	},
	{
		combo: "F6",
		label: "Show coupons",
		group: "Sale",
		handler: () => ui.setWorkspace(ui.workspace === "coupons" ? "catalog" : "coupons"),
	},
	{
		combo: "F3",
		label: "Held invoices",
		group: "Sale",
		handler: () => ui.openModal("drafts"),
	},
	{
		combo: "shift+F3",
		label: "Return against an invoice",
		group: "Sale",
		handler: () => ui.openModal("returns"),
	},
	{
		combo: "Escape",
		label: "Back to items",
		group: "Sale",
		handler: () => {
			if (ui.modal) ui.closeModal();
			else if (ui.workspace !== "catalog") ui.setWorkspace("catalog");
			else catalog.clearFilters();
		},
	},
	{ combo: "shift+F12", label: "Clear the cart", group: "Sale", handler: () => cart.reset() },
]);
onUnmounted(stop);
</script>

<template>
	<div class="grid h-full min-h-0 grid-cols-1 gap-3 p-3 lg:grid-cols-12">
		<!-- Left 5/12 — items, offers, coupons or payment -->
		<div
			class="min-h-0 lg:col-span-5"
			:class="ui.workspace !== 'catalog' && 'max-lg:hidden'"
		>
			<Transition
				mode="out-in"
				enter-active-class="transition duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
				enter-from-class="opacity-0 -translate-x-3 scale-[0.98]"
				leave-active-class="transition duration-150 ease-out"
				leave-to-class="opacity-0 translate-x-3 scale-[0.98]"
			>
				<PaymentPanel v-if="ui.workspace === 'payment'" key="payment" />
				<OffersPanel v-else-if="ui.workspace === 'offers'" key="offers" />
				<CouponsPanel v-else-if="ui.workspace === 'coupons'" key="coupons" />
				<CatalogPanel v-else key="catalog" />
			</Transition>
		</div>

		<!-- Right 7/12 — the invoice, always on screen -->
		<div class="min-h-0 lg:col-span-7" :class="ui.workspace !== 'catalog' && 'max-lg:col-span-full'">
			<CartPanel @pay="toPayment" />
		</div>

		<ModalHost />
	</div>
</template>
