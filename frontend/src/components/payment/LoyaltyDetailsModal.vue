<script setup lang="ts">
/** Loyalty balance breakdown for the customer on the ticket. */
import { computed, onMounted, ref } from "vue";
import { Coins } from "lucide-vue-next";
import { api } from "@/lib/api";
import { formatDate, formatFloat, relativeTime } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

interface LoyaltyEntry {
	invoice: string;
	loyalty_points: number;
	expiry_date: string | null;
	loyalty_program: string;
}

const cart = useCartStore();
const ui = useUiStore();

const rows = ref<LoyaltyEntry[]>([]);
const loading = ref(true);

const customer = computed(() => cart.customerInfo?.customer_name ?? cart.customer);

/** Days from today until an entry's points run out; null for non-expiring. */
function daysToExpiry(date: string | null): number | null {
	if (!date) return null;
	const ms = new Date(`${date}T00:00:00`).getTime() - Date.now();
	return Math.ceil(ms / 86_400_000);
}

const totalPoints = computed(() => rows.value.reduce((sum, row) => sum + toNum(row.loyalty_points), 0));

/** Entries whose points lapse soon; keeps the "expiring" chip honest. */
const expiringSoon = computed(() => {
	const soon = rows.value.filter((row) => {
		const days = daysToExpiry(row.expiry_date);
		return days !== null && days <= 30;
	});
	if (!soon.length) return null;
	return soon.reduce((sum, row) => sum + toNum(row.loyalty_points), 0);
});

const subtitle = computed(() =>
	cart.customer ? `${customer.value} · ${formatFloat(totalPoints.value, 0)} points in hand` : "",
);

onMounted(async () => {
	if (!cart.customer) {
		loading.value = false;
		return;
	}
	try {
		rows.value = ((await api.loyaltyPointsDetails(cart.customer)) as LoyaltyEntry[]) ?? [];
	} catch (error) {
		ui.fail("Could not load loyalty points", error instanceof Error ? error.message : String(error));
		rows.value = [];
	} finally {
		loading.value = false;
	}
});

function toNum(value: number): number {
	return Number.isFinite(value) ? value : 0;
}
</script>

<template>
	<ModalShell title="Loyalty points" :subtitle="subtitle" width="max-w-lg" @close="ui.closeModal()">
		<div v-if="loading" class="space-y-2 p-4">
			<div v-for="n in 3" :key="n" class="skeleton h-12 rounded-card" />
		</div>

		<div v-else-if="!rows.length" class="flex flex-col items-center gap-2 p-10 text-center">
			<Coins class="size-8 text-subtle" />
			<p class="text-sm font-medium">No loyalty points yet</p>
			<p class="max-w-xs text-xs text-muted">Points start appearing once the customer earns on their first sale.</p>
		</div>

		<div v-else>
			<div class="flex items-center gap-2 rounded-card border border-violet/30 bg-violet-soft/25 p-3">
				<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-soft text-violet">
					<Coins class="size-4" />
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold">{{ formatFloat(totalPoints, 0) }} points</p>
					<p class="text-[11px] text-subtle">Redeemable against this sale</p>
				</div>
				<span
					v-if="expiringSoon !== null"
					class="shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
				>
					{{ formatFloat(expiringSoon, 0) }} expiring soon
				</span>
			</div>

			<ul class="mt-3 divide-y divide-line">
				<li v-for="row in rows" :key="row.invoice as string" class="flex items-center gap-3 px-4 py-2.5">
					<div class="min-w-0 flex-1">
						<p class="truncate font-mono text-xs text-subtle">{{ row.invoice }}</p>
						<p v-if="row.expiry_date" class="truncate text-[11px] text-subtle">
							Expires {{ formatDate(row.expiry_date) }}
							<span v-if="daysToExpiry(row.expiry_date) !== null" class="text-warning">
								· {{ relativeTime(row.expiry_date) }}
							</span>
						</p>
						<p v-else class="text-[11px] text-subtle">Does not expire</p>
					</div>
					<span class="shrink-0 text-sm font-bold tnum text-violet">
						+{{ formatFloat(row.loyalty_points, 0) }}
					</span>
				</li>
			</ul>
		</div>
	</ModalShell>
</template>