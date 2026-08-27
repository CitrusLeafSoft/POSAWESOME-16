<script setup lang="ts">
/** Full read-only view of a single cart line. */
import { computed } from "vue";
import ModalShell from "@/components/common/ModalShell.vue";
import { useUiStore } from "@/stores/ui";
import { formatCurrency, formatFloat } from "@/lib/format";
import type { CartItem } from "@/types";

const props = defineProps<{ line: CartItem }>();
const ui = useUiStore();

console.log("item in modal: ", props.line)

const hasDiscount = computed(() => props.line.discount_percentage > 0);
</script>

<template>
	<ModalShell
		:title="line.item_name"
		:subtitle="line.item_code"
		width="max-w-md"
		@close="ui.closeModal()"
	>
		<div class="grid gap-4 p-4">
			<div v-if="line.image" class="overflow-hidden rounded-card border border-line bg-surface-2">
				<img :src="line.image" :alt="line.item_name" class="size-full max-h-48 w-full object-contain" />
			</div>

			<p
			v-if="line.description"
			class="text-xs leading-relaxed text-muted"
			v-html="line.description"
			></p>

			<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
				<div class="flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Item group</dt>
					<dd class="font-medium">{{ line.item_group }}</dd>
				</div>
				<div class="flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Warehouse</dt>
					<dd class="font-medium">{{ line.warehouse }}</dd>
				</div>
				<div class="flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Unit</dt>
					<dd class="font-medium">
						{{ line.uom }}
						<span
							v-if="line.uom !== line.stock_uom"
							class="text-[11px] text-subtle"
							:title="`Base unit: ${line.stock_uom}`"
						>
							({{ line.stock_uom }})
						</span>
					</dd>
				</div>
				<div v-if="line.batch_no" class="flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Batch</dt>
					<dd class="font-mono text-xs">{{ line.batch_no }}</dd>
				</div>
				<div v-if="line.serial_no" class="col-span-2 flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Serial no.</dt>
					<dd class="font-mono text-xs break-words">{{ line.serial_no }}</dd>
				</div>
				<div v-if="line.custom_nlc || line.custom_nlc === 0" class="flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">NLC</dt>
					<dd class="font-semibold tnum">{{ formatCurrency(line.custom_nlc) }}</dd>
				</div>
				<div v-if="line.custom_rsp || line.custom_rsp === 0" class="flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">RSP</dt>
					<dd class="font-semibold tnum">{{ formatCurrency(line.custom_rsp) }}</dd>
				</div>
				<div v-if="line.actual_qty" class="flex flex-col">
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">In stock</dt>
					<dd class="font-medium tnum">{{ formatFloat(line.actual_qty, 2) }} {{ line.stock_uom }}</dd>
				</div>
				<div
					v-if="line.conversion_factor && line.conversion_factor !== 1"
					class="flex flex-col"
				>
					<dt class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Conversion</dt>
					<dd class="font-medium tnum">{{ line.conversion_factor }}</dd>
				</div>
			</dl>

			<div class="divide-y divide-line rounded-card border border-line">
				<div class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
					<span class="text-muted">Selling price</span>
					<span class="font-semibold tnum">{{ formatCurrency(line.price_list_rate) }}</span>
				</div>
				<div v-if="line.custom_nlc || line.custom_nlc === 0" class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
					<span class="text-muted">NLC</span>
					<span class="font-semibold tnum">{{ formatCurrency(line.custom_nlc) }}</span>
				</div>
				<div v-if="line.custom_rsp || line.custom_rsp === 0" class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
					<span class="text-muted">RSP</span>
					<span class="font-semibold tnum">{{ formatCurrency(line.custom_rsp) }}</span>
				</div>
				<div class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
					<span class="text-muted">Quantity</span>
					<span class="font-semibold tnum">{{ formatFloat(line.qty, 2) }}</span>
				</div>
				<div class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
					<span class="text-muted">Rate</span>
					<span class="font-semibold tnum">{{ formatCurrency(line.rate) }}</span>
				</div>
				<div v-if="hasDiscount" class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
					<span class="text-muted">Discount</span>
					<span class="font-semibold tnum text-success">
						{{ formatFloat(line.discount_amount, 2) }} ({{ formatFloat(line.discount_percentage, 2) }}%)
					</span>
				</div>
				<div class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
					<span class="text-muted">Line total</span>
					<span class="font-bold tnum">{{ formatCurrency(line.amount) }}</span>
				</div>
			</div>
		</div>

		<template #footer>
			<button
				type="button"
				class="h-11 w-full rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
				@click="ui.closeModal()"
			>
				Close
			</button>
		</template>
	</ModalShell>
</template>