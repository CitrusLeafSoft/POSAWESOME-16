<script setup lang="ts">
/** Shift summary and close-out. Numbers first, then the irreversible button. */
import { computed, onMounted, ref } from "vue";
import { ArrowLeft, BarChart3, Loader2, LockKeyhole, Receipt } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { api } from "@/lib/api";
import { formatCurrency, formatDateTime, formatFloat, toNumber } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import type { ShiftAnalytics, DraftShiftInvoice, ReasonForCancellation } from "@/types";

const session = useSessionStore();
const ui = useUiStore();
const router = useRouter();

const stats = ref<ShiftAnalytics | null>(null);
const loading = ref(true);
const closing = ref(false);
/** Counted cash per mode, entered by the cashier at close. */
const counted = ref<Record<string, number>>({});

const peakHour = computed(() => {
	const hours = stats.value?.hourly ?? [];
	if (!hours.length) return null;
	return hours.reduce((best, row) => (row.amount > best.amount ? row : best), hours[0]);
});

const draftInvoices = ref<DraftShiftInvoice[]>([]);
const reasonsForCancellation = ref<ReasonForCancellation[]>([]);
const selectedReasons = ref<Record<string, string>>({});

// reason = draft_invoices_with_cancellation_reason.get(invoice.name) if draft_invoices_with_cancellation_reason else None

onMounted(async () => {
	if (!session.shiftName) {
		loading.value = false;
		return;
	}
	try {
		stats.value = (await api.shiftAnalytics(session.shiftName)) as ShiftAnalytics;
		draftInvoices.value = (await api.shiftDraftInvoices(session.shiftName)) as DraftShiftInvoice[];
		reasonsForCancellation.value = (await api.reasonForCancellation()) as ReasonForCancellation[];
		for (const row of stats.value?.payment_mix ?? []) counted.value[row.mode_of_payment] = row.amount;
	} catch (error) {
		ui.fail("Could not load the shift summary", error instanceof Error ? error.message : String(error));
	} finally {
		loading.value = false;
	}
});

const missingReasons = computed(() =>
	draftInvoices.value.filter((inv) => !selectedReasons.value[inv.name]?.trim())
);

function variance(mode: string, expected: number) {
	return toNumber(counted.value[mode]) - expected;
}

async function close() {
	if (!session.shiftName) return;
	
	if (missingReasons.value.length > 0) {
		ui.fail(
			"Reason required",
			`Please provide a cancellation reason for: ${missingReasons.value.map((i) => i.name).join(", ")}`
		);
		return;
	}
	
	closing.value = true;

	try {
		const reasonsPayload =
			draftInvoices.value.length > 0
				? JSON.stringify(
						Object.fromEntries(
							draftInvoices.value.map((inv) => [inv.name, selectedReasons.value[inv.name].trim()])
						)
					)
				: null;
		const draft = (await api.closingShiftFromOpening(session.shiftName, reasonsPayload)) as Record<string, unknown>;
		const rows = (draft.payment_reconciliation as Record<string, unknown>[] | undefined) ?? [];
		for (const row of rows) {
			const mode = row.mode_of_payment as string;
			if (counted.value[mode] !== undefined) row.closing_amount = toNumber(counted.value[mode]);
		}
		await api.submitClosingShift(draft);
		ui.success("Shift closed");
		session.endShift();
		void router.replace({ name: "shift" });
	} catch (error) {
		ui.fail("Could not close the shift", error instanceof Error ? error.message : String(error));
	} finally {
		closing.value = false;
	}
}
</script>

<template>
	<div class="h-full overflow-y-auto p-3">
		<div class="mx-auto w-full max-w-3xl space-y-3">
			<div class="flex items-center gap-2">
				<button type="button"
					class="grid size-9 place-items-center rounded-card text-muted transition hover:bg-surface-2 hover:text-fg"
					aria-label="Back to selling" @click="router.back()">
					<ArrowLeft class="size-4.5" />
				</button>
				<h1 class="text-base font-semibold">Close shift</h1>
				<span v-if="stats" class="ml-auto text-xs text-subtle">
					Opened {{ formatDateTime(stats.opened_at) }}
				</span>
			</div>

			<div v-if="loading" class="grid gap-3 sm:grid-cols-4">
				<div v-for="n in 4" :key="n" class="skeleton h-24 rounded-panel" />
			</div>

			<p v-else-if="!session.shiftName" class="panel p-6 text-center text-sm text-muted">
				No shift is open on this terminal.
			</p>

			<template v-else-if="stats">
				<!-- KPIs -->
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<div class="panel p-4">
						<p class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Sales</p>
						<p class="mt-1 text-2xl font-bold tnum">{{ formatCurrency(stats.grand_total) }}</p>
						<p class="text-xs text-muted">{{ stats.invoice_count }} invoices</p>
					</div>
					<div class="panel p-4">
						<p class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Returns</p>
						<p class="mt-1 text-2xl font-bold tnum text-danger">{{ formatCurrency(stats.total_returned) }}
						</p>
						<p class="text-xs text-muted">{{ stats.return_count }} returns</p>
					</div>
					<div class="panel p-4">
						<p class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Average basket</p>
						<p class="mt-1 text-2xl font-bold tnum">{{ formatCurrency(stats.average_basket) }}</p>
						<p class="text-xs text-muted">{{ formatFloat(stats.total_qty) }} items sold</p>
					</div>
					<div class="panel p-4">
						<p class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Discounts</p>
						<p class="mt-1 text-2xl font-bold tnum text-warning">{{ formatCurrency(stats.total_discount) }}
						</p>
						<p v-if="peakHour" class="text-xs text-muted">Busiest {{ peakHour.hour }}:00</p>
					</div>
				</div>

				<!-- Reconciliation -->
				<div class="panel overflow-hidden">
					<header class="flex items-center gap-2 border-b border-line px-4 py-3">
						<Receipt class="size-4 text-subtle" />
						<h2 class="text-sm font-semibold">Count the drawer</h2>
					</header>
					<div class="divide-y divide-line">
						<div v-for="row in stats.payment_mix" :key="row.mode_of_payment"
							class="flex items-center gap-3 px-4 py-2.5">
							<span class="min-w-0 flex-1 truncate text-sm">{{ row.mode_of_payment }}</span>
							<span class="w-28 text-right text-sm tnum text-muted">{{ formatCurrency(row.amount)
								}}</span>
							<input v-model.number="counted[row.mode_of_payment]" type="text" inputmode="decimal"
								class="h-9 w-28 rounded-card border-line bg-surface-2 text-right text-sm font-semibold tnum focus:border-accent focus:ring-0"
								:aria-label="`Counted ${row.mode_of_payment}`" />
							<span class="w-24 text-right text-xs font-semibold tnum" :class="variance(row.mode_of_payment, row.amount) === 0
									? 'text-subtle'
									: variance(row.mode_of_payment, row.amount) > 0
										? 'text-success'
										: 'text-danger'
								">
								{{ variance(row.mode_of_payment, row.amount) > 0 ? "+" : ""
								}}{{ formatCurrency(variance(row.mode_of_payment, row.amount)) }}
							</span>
						</div>
					</div>
				</div>

				<!-- Top items -->
				<div v-if="stats.top_items?.length" class="panel overflow-hidden">
					<header class="flex items-center gap-2 border-b border-line px-4 py-3">
						<BarChart3 class="size-4 text-subtle" />
						<h2 class="text-sm font-semibold">Top sellers</h2>
					</header>
					<ul class="divide-y divide-line">
						<li v-for="item in stats.top_items.slice(0, 8)" :key="item.item_code"
							class="flex items-center gap-3 px-4 py-2 text-sm">
							<span class="min-w-0 flex-1 truncate">{{ item.item_name }}</span>
							<span class="shrink-0 text-xs tnum text-subtle">{{ formatFloat(item.qty) }}×</span>
							<span class="w-24 shrink-0 text-right tnum font-semibold">{{ formatCurrency(item.amount)
								}}</span>
						</li>
					</ul>
				</div>

				<!-- Draft invoices -->
				<div v-if="draftInvoices.length > 0" class="panel overflow-hidden">
					<header class="flex items-center gap-2 border-b border-line px-4 py-3">
						<Receipt class="size-4 text-subtle" />
						<h2 class="text-sm font-semibold">Draft invoices</h2>
						<span class="ml-auto text-xs text-muted">Give each a cancellation reason before closing</span>
					</header>
					<ul class="divide-y divide-line">
						<li v-for="invoice in draftInvoices" :key="invoice.name"
							class="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
							<span class="shrink-0 text-xs tnum text-subtle">{{ invoice.name }}</span>
							<span class="min-w-0 flex-1 truncate">{{ invoice.customer_name || invoice.customer }}</span>
							<span class="min-w-0 truncate text-xs text-subtle">{{ invoice.workflow_state || invoice.status }}</span>
							<span class="shrink-0 text-xs tnum text-subtle">{{ formatDateTime(invoice.modified) }}</span>
							<span class="w-24 shrink-0 text-right tnum font-semibold">{{ formatCurrency(invoice.grand_total) }}</span>

							<input
								v-model="selectedReasons[invoice.name]"
								type="text"
								list="cancellation-reasons"
								placeholder="Reason for cancellation…"
								class="h-9 w-52 rounded-card border-line bg-surface-2 px-2 text-sm focus:border-accent focus:ring-0"
								:class="{ 'border-danger': !selectedReasons[invoice.name]?.trim() }"
								:aria-label="`Cancellation reason for ${invoice.name}`"
							/>
						</li>
					</ul>
					<datalist id="cancellation-reasons">
						<option v-for="r in reasonsForCancellation" :key="r.reason" :value="r.reason" />
					</datalist>
				</div>

				<button type="button"
					class="flex h-12 w-full items-center justify-center gap-2 rounded-card bg-danger font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none"
					:disabled="closing || missingReasons.length > 0" @click="close">
					<Loader2 v-if="closing" class="size-5 animate-spin" />
					<LockKeyhole v-else class="size-5" />
					{{ closing ? "Closing…" : missingReasons.length > 0 ? `${missingReasons.length} reason(s) needed` : "Close shift" }}
				</button>
			</template>
		</div>
	</div>
</template>
