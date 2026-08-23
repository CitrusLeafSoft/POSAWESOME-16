<script setup lang="ts">
import { computed } from "vue";
import { ImageOff, Plus } from "lucide-vue-next";
import { formatCurrency, formatFloat } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import type { Item } from "@/types";

const props = defineProps<{ item: Item; index?: number }>();
defineEmits<{ pick: [Item] }>();

const session = useSessionStore();
const outOfStock = computed(
	() => props.item.is_stock_item === 1 && props.item.actual_qty <= 0 && !session.stockSettings.allow_negative_stock,
);
</script>

<template>
	<button
		type="button"
		class="stagger group flex w-full items-center gap-3 rounded-card border border-transparent px-2 py-2 text-left transition hover:border-line hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
		:style="{ '--i': index ?? 0 }"
		:disabled="outOfStock"
		@click="$emit('pick', item)"
	>
		<span class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2">
			<img v-if="item.image" :src="item.image" :alt="item.item_name" loading="lazy" class="size-full object-cover" />
			<ImageOff v-else class="size-4 text-subtle" />
		</span>

		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-medium">{{ item.item_name }}</span>
			<span class="block truncate font-mono text-[11px] text-subtle">{{ item.item_code }}</span>
		</span>

		<span v-if="item.is_stock_item" class="hidden shrink-0 text-xs tnum text-subtle sm:block">
			{{ formatFloat(item.actual_qty) }} {{ item.stock_uom }}
		</span>

		<span class="shrink-0 text-sm font-bold tnum text-accent">
			{{ formatCurrency(item.rate, item.currency || session.currency) }}
		</span>

		<span
			class="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent opacity-0 transition group-hover:opacity-100"
		>
			<Plus class="size-4" />
		</span>
	</button>
</template>
