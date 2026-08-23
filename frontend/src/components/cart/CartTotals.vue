<script setup lang="ts">
import { computed } from "vue";
import { formatCurrency, formatFloat, toNumber } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { useSessionStore } from "@/stores/session";

const cart = useCartStore();
const session = useSessionStore();

const t = computed(() => cart.totals);
const canDiscount = computed(() => !!session.profile?.posa_allow_user_to_edit_additional_discount);
const usePercentage = computed(() => !!session.profile?.posa_use_percentage_discount);

/** A trailing % always means percentage; otherwise the profile's preference decides. */
function commit(event: Event) {
	const raw = (event.target as HTMLInputElement).value.trim();
	if (!raw) {
		cart.setAdditionalDiscount(0, "percentage");
		return;
	}
	if (raw.endsWith("%")) cart.setAdditionalDiscount(toNumber(raw.slice(0, -1)), "percentage");
	else cart.setAdditionalDiscount(toNumber(raw), usePercentage.value ? "percentage" : "amount");
}
</script>

<template>
	<div class="space-y-1.5 border-t border-line px-4 py-3 text-sm">
		<div class="flex justify-between text-muted">
			<span>Subtotal <span class="text-subtle">({{ formatFloat(t.totalQty) }} qty)</span></span>
			<span class="tnum">{{ formatCurrency(t.total) }}</span>
		</div>

		<div v-if="t.itemDiscountTotal > 0" class="flex justify-between text-success">
			<span>Item discounts</span>
			<span class="tnum">− {{ formatCurrency(t.itemDiscountTotal) }}</span>
		</div>

		<div class="flex items-center justify-between gap-2 text-muted">
			<label :for="'addl-disc'" class="shrink-0">
				Discount<span class="text-subtle"> (10 or 10%)</span>
			</label>
			<input
				id="addl-disc"
				:value="
					usePercentage
						? formatFloat(cart.additionalDiscountPercentage, 2)
						: formatFloat(cart.additionalDiscount, 2)
				"
				type="text"
				inputmode="decimal"
				placeholder="0"
				:disabled="!canDiscount"
				class="h-8 w-24 rounded-card border-line bg-surface text-right text-sm tnum shadow-xs focus:border-accent focus:ring-0 disabled:bg-surface-2 disabled:text-subtle"
				@change="commit($event)"
			/>
		</div>

		<div v-for="tax in t.taxes" :key="tax.idx" class="flex justify-between text-muted">
			<span class="truncate pr-2">{{ tax.description || tax.account_head }}</span>
			<span class="tnum">{{ formatCurrency(tax.tax_amount) }}</span>
		</div>

		<div
			v-if="t.roundingAdjustment"
			class="flex justify-between text-xs text-subtle"
		>
			<span>Rounding</span>
			<span class="tnum">{{ formatCurrency(t.roundingAdjustment) }}</span>
		</div>

		<div class="flex items-baseline justify-between border-t border-line pt-2">
			<span class="font-semibold">Total</span>
			<span class="text-xl font-bold tnum text-accent">{{ formatCurrency(cart.payableAmount) }}</span>
		</div>
	</div>
</template>
