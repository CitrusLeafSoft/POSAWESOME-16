<script setup lang="ts">
/** Tender screen. Big targets, tabular numbers, and one obvious primary action. */
import { computed, watch } from "vue";
import { ArrowLeft, Banknote, Check, CheckCircle2, Coins, Printer, Plus } from "lucide-vue-next";
import { formatCurrency, formatFloat, toNumber } from "@/lib/format";
import { usePaymentsStore } from "@/stores/payments";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import { useOffersStore } from "@/stores/offers";

const payments = usePaymentsStore();
const cart = useCartStore();
const ui = useUiStore();
const offers = useOffersStore();

/** Round-number shortcuts a cashier actually reaches for. */
const QUICK = [5, 10, 20, 50, 100, 200, 500];

const done = computed(() => !!payments.lastInvoice);
const isReturn = computed(() => cart.isReturn);
/** Loyalty redemption shows whenever the customer carries a balance to spend. */
const canRedeem = computed(
	() =>
		!isReturn.value &&
		toNumber(cart.customerInfo?.loyalty_points) > 0 &&
		toNumber(cart.customerInfo?.conversion_factor) > 0,
);

// Totals can settle after entry (taxes arriving with the draft save); while the
// cashier has not touched the amounts, keep tender pinned to what is owed.
watch(
	() => payments.payable,
	() => {
		if (!done.value && !payments.touched) payments.tenderExact();
	},
);

function back() {
	ui.setWorkspace("catalog");
}

async function complete() {
	const result = await payments.submit();
	if (!result) return;
	// Keep the receipt on screen; the cart is cleared when the cashier moves on.
	offers.reset();
}

function nextSale() {
	cart.reset();
	payments.reset();
	offers.reset();
	ui.setWorkspace("catalog");
}

function commitRedemption(event: Event) {
	const raw = (event.target as HTMLInputElement).value.trim();
	cart.setLoyaltyRedemption(toNumber(raw));
	payments.tenderExact();
}

/** Open the in-page print dialog; the browser's print sheet stays over this view. */
function print() {
	const name = payments.lastInvoice?.name as string | undefined;
	if (!name) return;
	ui.openModal("print", { invoiceName: name });
}
</script>

<template>
	<section class="panel flex h-full min-h-0 flex-col overflow-hidden">
		<!-- Success state -->
		<div v-if="done" class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
			<span class="grid size-16 place-items-center rounded-full bg-success-soft text-success animate-pop-in">
				<CheckCircle2 class="size-8" />
			</span>
			<div>
				<h2 class="text-lg font-semibold">{{ isReturn ? "Refund complete" : "Sale complete" }}</h2>
				<p class="mt-0.5 font-mono text-xs text-subtle">{{ payments.lastInvoice?.name }}</p>
			</div>

			<div v-if="payments.change > 0" class="panel bg-surface-2 px-6 py-4">
				<p class="text-xs font-medium uppercase tracking-wide text-subtle">
					{{ isReturn ? "Over-refunded" : "Change due" }}
				</p>
				<p class="mt-0.5 text-3xl font-bold tnum text-warning">{{ formatCurrency(payments.change) }}</p>
			</div>

			<div class="mt-2 flex w-full max-w-xs flex-col gap-2">
				<button
					type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
					@click="nextSale"
				>
					<Plus class="size-4" />
					New sale
				</button>
				<button
					type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card border border-line font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="print"
				>
					<Printer class="size-4" />
					Print receipt
				</button>
			</div>
		</div>

		<!-- Tender state -->
		<template v-else>
			<header class="flex shrink-0 items-center gap-2 border-b border-line p-3">
				<button
					type="button"
					class="grid size-9 place-items-center rounded-card text-muted transition hover:bg-surface-2 hover:text-fg"
					aria-label="Back to catalog"
					@click="back"
				>
					<ArrowLeft class="size-4.5" />
				</button>
				<h2 class="text-sm font-semibold">{{ isReturn ? "Refund" : "Payment" }}</h2>
				<span class="ml-auto text-right">
					<span class="block text-[11px] uppercase tracking-wide text-subtle">
						{{ isReturn ? "Refund due" : "Due" }}
					</span>
					<span
						class="block text-lg font-bold tnum leading-tight"
						:class="isReturn && 'text-danger'"
						>{{ formatCurrency(Math.abs(payments.payable)) }}</span
					>
				</span>
			</header>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
				<!-- Modes -->
				<div class="space-y-2">
					<div
						v-for="row in payments.rows"
						:key="row.mode_of_payment"
						class="flex items-center gap-2 rounded-card border border-line bg-surface p-2 shadow-xs transition focus-within:border-accent"
					>
						<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
							<Banknote class="size-4" />
						</span>
						<label class="min-w-0 flex-1 truncate text-sm font-medium" :for="`pay-${row.mode_of_payment}`">
							{{ row.mode_of_payment }}
						</label>
						<input
							:id="`pay-${row.mode_of_payment}`"
							:value="row.amount ? Math.abs(row.amount) : ''"
							type="text"
							inputmode="decimal"
							placeholder="0.00"
							class="h-10 w-32 rounded-card border-line bg-surface-2 text-right text-base font-semibold tnum focus:border-accent focus:ring-0"
							@focus="($event.target as HTMLInputElement).select()"
							@input="payments.setAmount(row.mode_of_payment, toNumber(($event.target as HTMLInputElement).value))"
						/>
					</div>
				</div>

				<!-- Loyalty redemption — points settle part of the total before cash -->
				<div
					v-if="canRedeem"
					class="flex items-center gap-2 rounded-card border border-dashed border-violet/40 bg-violet-soft/40 p-2"
				>
					<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-soft text-violet">
						<Coins class="size-4" />
					</span>
					<label class="min-w-0 flex-1 text-sm font-medium" for="loyalty-redeem">
						Redeem loyalty
						<span class="block text-[11px] font-normal text-subtle">
							{{ formatFloat(cart.customerInfo?.loyalty_points ?? 0, 0) }} pts available ·
							{{ formatCurrency(cart.maxLoyaltyAmount) }}
						</span>
					</label>
					<input
						id="loyalty-redeem"
						:value="cart.loyaltyAmount || ''"
						type="text"
						inputmode="decimal"
						placeholder="0.00"
						class="h-10 w-28 rounded-card border-line bg-surface text-right text-sm font-semibold tnum focus:border-accent focus:ring-0"
						@focus="($event.target as HTMLInputElement).select()"
						@change="commitRedemption($event)"
					/>
				</div>

				<!-- Quick cash -->
				<div>
					<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">Quick add</p>
					<div class="flex flex-wrap gap-1.5">
						<button
							v-for="amount in QUICK"
							:key="amount"
							type="button"
							class="h-9 min-w-14 rounded-card border border-line bg-surface px-3 text-sm font-semibold tnum shadow-xs transition hover:border-accent hover:text-accent"
							@click="payments.addAmount(payments.rows.find((r) => r.default)?.mode_of_payment ?? payments.rows[0]?.mode_of_payment ?? '', amount)"
						>
							+{{ amount }}
						</button>
						<button
							type="button"
							class="h-9 rounded-card border border-accent bg-accent-soft px-3 text-sm font-semibold text-accent transition hover:opacity-85"
							@click="payments.tenderExact()"
						>
							Exact
						</button>
						<button
							type="button"
							class="h-9 rounded-card border border-line px-3 text-sm font-medium text-muted transition hover:bg-surface-2"
							@click="payments.clear()"
						>
							Clear
						</button>
					</div>
				</div>
			</div>

			<!-- Balance + complete -->
			<footer class="shrink-0 space-y-2 border-t border-line p-3">
				<div class="flex justify-between text-sm">
					<span class="text-muted">{{ isReturn ? "Refunded" : "Tendered" }}</span>
					<span class="font-semibold tnum">{{ formatCurrency(Math.abs(payments.paid)) }}</span>
				</div>
				<div class="flex justify-between text-sm">
					<span :class="payments.outstanding > 0 ? 'text-danger' : 'text-muted'">
						{{
							payments.outstanding > 0
								? isReturn
									? "Still to refund"
									: "Still owed"
								: isReturn
									? "Over-refunded"
									: "Change"
						}}
					</span>
					<span
						class="font-bold tnum"
						:class="payments.outstanding > 0 ? 'text-danger' : 'text-success'"
					>
						{{ formatCurrency(payments.outstanding > 0 ? payments.outstanding : payments.change) }}
					</span>
				</div>

				<button
					type="button"
					class="flex h-13 w-full items-center justify-center gap-2 rounded-card text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none"
					:class="isReturn ? 'bg-danger' : 'bg-success'"
					:disabled="!payments.canSubmit"
					@click="complete"
				>
					<Loader2 v-if="payments.submitting" class="size-5 animate-spin" />
					<Check v-else class="size-5" />
					{{
						payments.submitting
							? isReturn
								? "Refunding…"
								: "Completing…"
							: isReturn
								? "Complete refund"
								: "Complete sale"
					}}
				</button>
			</footer>
		</template>
	</section>
</template>
