<script setup lang="ts">
/** Pick attribute values to resolve a template item down to a sellable variant. */
import { computed, onMounted, ref } from "vue";
import { Layers } from "lucide-vue-next";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { useCatalogStore } from "@/stores/catalog";
import { useUiStore } from "@/stores/ui";
import type { Item, ItemAttribute } from "@/types";
import ModalShell from "@/components/common/ModalShell.vue";

const props = defineProps<{ itemCode: string; itemName?: string }>();

const cart = useCartStore();
const catalog = useCatalogStore();
const ui = useUiStore();

const attributes = ref<ItemAttribute[]>([]);
const chosen = ref<Record<string, string>>({});
const loading = ref(true);

onMounted(async () => {
	try {
		attributes.value = ((await api.itemAttributes(props.itemCode)) as ItemAttribute[]) ?? [];
	} catch (error) {
		ui.fail("Could not load variants", error instanceof Error ? error.message : String(error));
	} finally {
		loading.value = false;
	}
});

const complete = computed(() =>
	attributes.value.every((attr) => attr.optional || chosen.value[attr.attribute]),
);

/** Variants of the template whose attribute values match every choice made. */
const matches = computed<Item[]>(() =>
	catalog.items.filter((item) => {
		if (item.variant_of !== props.itemCode) return false;
		const values = Array.isArray(item.item_attributes) ? item.item_attributes : [];
		return Object.entries(chosen.value).every(([attribute, value]) =>
			values.some((row) => row.attribute === attribute && row.attribute_value === value),
		);
	}),
);

async function add(item: Item) {
	await cart.addItem(item);
	ui.closeModal();
}
</script>

<template>
	<ModalShell
		:title="itemName || itemCode"
		subtitle="Choose a variant"
		width="max-w-lg"
		@close="ui.closeModal()"
	>
		<div v-if="loading" class="space-y-3 p-4">
			<div v-for="n in 3" :key="n" class="skeleton h-10 rounded-card" />
		</div>

		<div v-else class="space-y-4 p-4">
			<div v-for="attr in attributes" :key="attr.attribute">
				<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
					{{ attr.attribute }}<span v-if="attr.optional" class="normal-case"> (optional)</span>
				</p>
				<div class="flex flex-wrap gap-1.5">
					<button
						v-for="value in attr.values"
						:key="value.attribute_value"
						type="button"
						class="rounded-card border px-3 py-1.5 text-xs font-medium transition"
						:class="
							chosen[attr.attribute] === value.attribute_value
								? 'border-accent bg-accent text-accent-fg'
								: 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
						"
						@click="
							chosen[attr.attribute] =
								chosen[attr.attribute] === value.attribute_value ? '' : value.attribute_value
						"
					>
						{{ value.attribute_value }}
					</button>
				</div>
			</div>

			<div class="border-t border-line pt-3">
				<p class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
					{{ matches.length }} matching
				</p>
				<p v-if="!complete" class="text-xs text-muted">Pick a value for every attribute.</p>
				<ul v-else-if="matches.length" class="space-y-1.5">
					<li v-for="item in matches.slice(0, 25)" :key="item.item_code">
						<button
							type="button"
							class="flex w-full items-center gap-3 rounded-card border border-line px-3 py-2 text-left transition hover:border-accent"
							@click="add(item)"
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm">{{ item.item_name }}</span>
								<span class="block truncate font-mono text-[11px] text-subtle">{{ item.item_code }}</span>
							</span>
							<span class="shrink-0 text-sm font-bold tnum text-accent">
								{{ formatCurrency(item.rate) }}
							</span>
						</button>
					</li>
				</ul>
				<div v-else class="flex items-center gap-2 text-xs text-warning">
					<Layers class="size-4" />
					No variant matches that combination.
				</div>
			</div>
		</div>
	</ModalShell>
</template>
