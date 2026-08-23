<script setup lang="ts">
/**
 * Reconcile an M-Pesa transaction against the sale.
 *
 * M-Pesa is not a card terminal: the customer pushes money from their phone and the
 * shop receives a webhook, which lands as a draft Mpesa Payment Register entry. So
 * the cashier is not *taking* a payment here, they are finding one that has already
 * arrived and attaching it to this customer.
 *
 * That is why the list is searchable by phone and name rather than being a keypad,
 * and why the amounts are shown as they were received and cannot be edited.
 */
import { computed, onMounted, ref } from "vue";
import { Loader2, RefreshCw, Search, Smartphone } from "lucide-vue-next";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { usePaymentsStore } from "@/stores/payments";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

interface MpesaPayment {
	name: string;
	transid: string;
	mobile_no: string;
	full_name: string;
	posting_date: string;
	amount: number;
	currency: string;
	mode_of_payment: string;
}

const cart = useCartStore();
const payments = usePaymentsStore();
const session = useSessionStore();
const ui = useUiStore();

const rows = ref<MpesaPayment[]>([]);
const modes = ref<string[]>([]);
const loading = ref(false);
const submitting = ref<string | null>(null);
const mobile = ref("");
const name = ref("");

/** Pre-fill from the customer on the ticket — usually the right search. */
onMounted(async () => {
	mobile.value = cart.customerInfo?.mobile_no ?? "";
	await loadModes();
	await search();
});

async function loadModes() {
	try {
		const result = (await api.mpesaModes(session.companyName)) as { mode_of_payment: string }[] | string[];
		modes.value = (result ?? []).map((row) =>
			typeof row === "string" ? row : row.mode_of_payment,
		);
	} catch {
		// Without the mode list the search simply covers every mode.
	}
}

async function search() {
	loading.value = true;
	try {
		rows.value = ((await api.mpesaDrafts({
			company: session.companyName,
			mobile_no: mobile.value || undefined,
			full_name: name.value || undefined,
			payment_methods_list: modes.value.length ? JSON.stringify(modes.value) : undefined,
		})) ?? []) as MpesaPayment[];
	} catch (error) {
		ui.fail("Could not load M-Pesa payments", error instanceof Error ? error.message : String(error));
		rows.value = [];
	} finally {
		loading.value = false;
	}
}

/**
 * Attach one transaction to this customer.
 *
 * Submitting the register entry creates the Payment Entry on the server, which then
 * shows up as spendable credit — so the credit list is reloaded rather than the
 * amount being written straight into a tender row. The money already exists; this
 * makes the till aware of it.
 */
async function attach(row: MpesaPayment) {
	if (!cart.customer) {
		ui.warn("Pick a customer first", "An M-Pesa payment has to be attached to an account.");
		return;
	}
	submitting.value = row.name;
	try {
		await api.submitMpesaPayment({ mpesa_payment: row.name, customer: cart.customer });
		ui.success("M-Pesa payment attached", `${row.transid} · ${formatCurrency(row.amount)}`);
		await payments.loadCredit();
		payments.applyMaxCredit();
		ui.closeModal();
	} catch (error) {
		ui.fail("Could not attach the payment", error instanceof Error ? error.message : String(error));
	} finally {
		submitting.value = null;
	}
}

const subtitle = computed(() =>
	cart.customer ? `Attaching to ${cart.customerInfo?.customer_name ?? cart.customer}` : "Pick a customer first",
);
</script>

<template>
	<ModalShell title="M-Pesa payments" :subtitle="subtitle" width="max-w-2xl" @close="ui.closeModal()">
		<div class="space-y-3 p-4">
			<div class="flex flex-wrap items-end gap-2">
				<label class="min-w-0 flex-1">
					<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
						Mobile
					</span>
					<input
						v-model="mobile"
						type="text"
						inputmode="tel"
						placeholder="07…"
						class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
						@keydown.enter.prevent="search"
					/>
				</label>
				<label class="min-w-0 flex-1">
					<span class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-subtle">
						Name
					</span>
					<input
						v-model="name"
						type="text"
						placeholder="As it came through"
						class="h-10 w-full rounded-card border-line bg-surface text-sm focus:border-accent focus:ring-0"
						@keydown.enter.prevent="search"
					/>
				</label>
				<button
					type="button"
					class="flex h-10 shrink-0 items-center gap-1.5 rounded-card bg-accent px-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
					@click="search"
				>
					<Search class="size-4" />
					Search
				</button>
				<button
					type="button"
					class="grid size-10 shrink-0 place-items-center rounded-card border border-line text-subtle transition hover:text-fg"
					aria-label="Reload"
					@click="search"
				>
					<RefreshCw class="size-4" :class="loading && 'animate-spin'" />
				</button>
			</div>

			<div v-if="loading && !rows.length" class="space-y-2">
				<div v-for="n in 3" :key="n" class="skeleton h-14 rounded-card" />
			</div>

			<div
				v-else-if="!rows.length"
				class="flex flex-col items-center justify-center gap-2 py-10 text-center"
			>
				<Smartphone class="size-8 text-subtle" />
				<p class="text-sm font-medium">No unreconciled payments</p>
				<p class="max-w-xs text-xs text-muted">
					Only transactions that have arrived and not yet been attached to a customer show
					here.
				</p>
			</div>

			<ul v-else class="divide-y divide-line">
				<li
					v-for="row in rows"
					:key="row.name"
					class="flex items-center gap-3 py-2.5"
				>
					<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
						<Smartphone class="size-4" />
					</span>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{{ row.full_name || row.mobile_no }}</p>
						<p class="truncate font-mono text-[11px] text-subtle">
							{{ row.transid }} · {{ row.mobile_no }} · {{ formatDate(row.posting_date) }}
						</p>
					</div>
					<span class="shrink-0 text-sm font-bold tnum">
						{{ formatCurrency(row.amount, row.currency) }}
					</span>
					<button
						type="button"
						class="h-9 shrink-0 rounded-card bg-success px-3 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
						:disabled="!!submitting || !cart.customer"
						@click="attach(row)"
					>
						<Loader2 v-if="submitting === row.name" class="size-4 animate-spin" />
						<span v-else>Attach</span>
					</button>
				</li>
			</ul>
		</div>
	</ModalShell>
</template>
