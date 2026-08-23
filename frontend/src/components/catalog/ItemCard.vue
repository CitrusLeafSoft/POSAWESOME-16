<script setup lang="ts">
import { computed } from "vue";
import { ImageOff, Layers, Hash } from "lucide-vue-next";
import { formatCurrency, formatFloat } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import type { Item } from "@/types";

const props = defineProps<{ item: Item; index?: number }>();
defineEmits<{ pick: [Item] }>();

const session = useSessionStore();

const showStock = computed(() => !!session.profile?.posa_display_items_in_stock && props.item.is_stock_item);
const outOfStock = computed(
	() => props.item.is_stock_item === 1 && props.item.actual_qty <= 0 && !session.stockSettings.allow_negative_stock,
);
</script>

<template>
	<button
		type="button"
		class="stagger group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface text-left transition duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-md focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:hover:shadow-none"
		:style="{ '--i': index ?? 0 }"
		:disabled="outOfStock"
		:title="item.item_code"
		@click="$emit('pick', item)"
	>
		<div class="relative aspect-square w-full overflow-hidden bg-surface-2">
			<img
				v-if="item.image"
				:src="item.image"
				:alt="item.item_name"
				loading="lazy"
				class="size-full object-cover transition duration-300 group-hover:scale-105"
			/>
			<span v-else class="grid size-full place-items-center text-subtle">
				<ImageOff class="size-6" />
			</span>

			<span
				v-if="showStock"
				class="absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tnum backdrop-blur-sm"
				:class="outOfStock ? 'bg-danger-soft text-danger' : 'bg-surface/85 text-muted'"
			>
				{{ formatFloat(item.actual_qty) }}
			</span>

			<span
				v-if="item.has_batch_no || item.has_serial_no"
				class="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-surface/85 text-subtle backdrop-blur-sm"
				:title="item.has_serial_no ? 'Serialised' : 'Batched'"
			>
				<Hash v-if="item.has_serial_no" class="size-3" />
				<Layers v-else class="size-3" />
			</span>
		</div>

		<div class="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
			<p class="line-clamp-2 text-xs font-medium leading-snug">{{ item.item_name }}</p>
			<p
				v-if="session.profile?.posa_display_item_code"
				class="truncate font-mono text-[10px] text-subtle"
			>
				{{ item.item_code }}
			</p>
			<p class="mt-auto pt-1 text-sm font-bold tnum text-accent">
				{{ formatCurrency(item.rate, item.currency || session.currency) }}
			</p>
		</div>
	</button>
</template>
