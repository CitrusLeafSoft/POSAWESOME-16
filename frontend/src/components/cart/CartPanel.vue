<script setup lang="ts">
/** The invoice: who it is for, what is on it, and what it comes to. */
import { computed, ref } from "vue";
import {
	ClipboardList,
	CreditCard,
	FileClock,
	Gift,
	Loader2,
	Pause,
	Percent,
	Settings2,
	ShoppingCart,
	Ticket,
	Trash2,
	Undo2,
	UserPen,
	UserPlus,
} from "lucide-vue-next";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import { useOffersStore } from "@/stores/offers";
import { useSessionStore } from "@/stores/session";
import CustomerPicker from "@/components/customer/CustomerPicker.vue";
import CartLine from "./CartLine.vue";
import CartTotals from "./CartTotals.vue";

const emit = defineEmits<{ pay: [] }>();

const cart = useCartStore();
const ui = useUiStore();
const offers = useOffersStore();
const session = useSessionStore();

const holding = ref(false);
const canPay = computed(() => !cart.isEmpty && !!cart.customer);

async function hold() {
	if (cart.isEmpty || !cart.customer) {
		ui.warn(cart.isEmpty ? "The cart is empty" : "Pick a customer first");
		return;
	}
	holding.value = true;
	try {
		const doc = await cart.saveDraft();
		if (doc) {
			ui.success("Invoice held", doc.name as string);
			cart.reset();
		}
	} catch (error) {
		ui.fail("Could not hold the invoice", error instanceof Error ? error.message : String(error));
	} finally {
		holding.value = false;
	}
}
</script>

<template>
	<section class="panel flex h-full min-h-0 flex-col overflow-hidden">
		<header class="shrink-0 space-y-2.5 p-3">
			<div class="flex items-center gap-2">
				<div class="min-w-0 flex-1"><CustomerPicker /></div>
				<button
					type="button"
					class="grid size-11 shrink-0 place-items-center rounded-card border border-line bg-surface text-muted shadow-xs transition hover:border-accent hover:text-accent"
					title="New customer"
					aria-label="New customer"
					@click="ui.openModal('customer')"
				>
					<UserPlus class="size-4" />
				</button>
				<button
					v-if="cart.customer"
					type="button"
					class="grid size-11 shrink-0 place-items-center rounded-card border border-line bg-surface text-muted shadow-xs transition hover:border-accent hover:text-accent"
					title="Edit customer"
					aria-label="Edit customer"
					@click="ui.openModal('customer', { customerId: cart.customer })"
				>
					<UserPen class="size-4" />
				</button>
			</div>

			<!-- Invoice actions -->
			<div class="flex items-center gap-1 overflow-x-auto pb-0.5">
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('drafts')"
				>
					<FileClock class="size-3.5" /> Held <kbd class="font-mono text-[10px] text-subtle">F3</kbd>
				</button>
				<button
					v-if="session.profile?.posa_allow_return"
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('returns')"
				>
					<Undo2 class="size-3.5" /> Return
				</button>
				<button
					v-if="session.profile?.posa_allow_sales_order || session.profile?.custom_allow_select_sales_order"
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('orders')"
				>
					<ClipboardList class="size-3.5" /> Orders
				</button>
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.setWorkspace('coupons')"
				>
					<Ticket class="size-3.5" /> Coupons
				</button>
				<button
					type="button"
					class="inline-flex shrink-0 items-center gap-1.5 rounded-card px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.openModal('invoiceDetails')"
				>
					<Settings2 class="size-3.5" /> Details
				</button>
			</div>

			<div class="flex items-center justify-between gap-2 text-xs">
				<span class="font-medium text-muted">
					{{ cart.itemCount }} {{ cart.itemCount === 1 ? "line" : "lines" }}
					<span v-if="cart.dirty && cart.invoiceName" class="text-warning"> · unsaved</span>
				</span>
				<div class="flex items-center gap-1">
					<button
						v-if="offers.pendingCount"
						type="button"
						class="inline-flex animate-pulse-ring items-center gap-1 rounded-full bg-violet-soft px-2 py-1 text-[11px] font-semibold text-violet transition hover:opacity-85"
						@click="ui.setWorkspace('offers')"
					>
						<Percent class="size-3" />
						{{ offers.pendingCount }} offer{{ offers.pendingCount === 1 ? "" : "s" }}
					</button>
					<span
						v-else-if="offers.appliedCount"
						class="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success"
					>
						<Gift class="size-3" /> {{ offers.appliedCount }} applied
					</span>
					<button
						v-if="!cart.isEmpty"
						type="button"
						class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-subtle transition hover:bg-danger-soft hover:text-danger"
						@click="cart.reset()"
					>
						<Trash2 class="size-3" /> Clear
					</button>
				</div>
			</div>
		</header>

		<!-- Lines -->
		<div class="min-h-0 flex-1 overflow-y-auto border-t border-line">
			<div
				v-if="cart.isEmpty"
				class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"
			>
				<ShoppingCart class="size-10 text-subtle" />
				<p class="text-sm font-medium">Nothing in the cart</p>
				<p class="max-w-[18rem] text-xs text-muted">
					Scan a barcode or pick an item to start the sale.
				</p>
			</div>

		<TransitionGroup
			v-else
			tag="div"
			class="relative divide-y divide-line"
			enter-active-class="transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
			enter-from-class="-translate-y-2 opacity-0"
			leave-active-class="absolute inset-x-0 transition duration-200 ease-out pointer-events-none"
			leave-to-class="translate-x-8 opacity-0"
			move-class="transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
		>
			<CartLine v-for="line in cart.items" :key="line.posa_row_id" :line="line" />
		</TransitionGroup>
		</div>

		<CartTotals v-if="!cart.isEmpty" />

		<footer class="flex shrink-0 gap-2 p-3 pt-0">
			<button
				type="button"
				class="flex h-13 w-13 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-muted shadow-xs transition hover:border-warning hover:text-warning disabled:opacity-40"
				title="Hold this invoice"
				aria-label="Hold this invoice"
				:disabled="!canPay || holding"
				@click="hold"
			>
				<Loader2 v-if="holding" class="size-5 animate-spin" />
				<Pause v-else class="size-5" />
			</button>
			<button
				type="button"
				class="flex h-13 min-w-0 flex-1 items-center justify-center gap-2 rounded-card bg-accent text-base font-semibold text-accent-fg shadow-glow transition hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none"
				:disabled="!canPay"
				@click="emit('pay')"
			>
				<CreditCard class="size-5" />
				Pay
				<kbd class="ml-1 rounded bg-black/15 px-1.5 py-0.5 font-mono text-[11px]">F8</kbd>
			</button>
		</footer>
	</section>
</template>
