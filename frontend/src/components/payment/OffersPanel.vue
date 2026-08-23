<script setup lang="ts">
/** Offers the cart currently qualifies for. Auto offers arrive switched on. */
import { ArrowLeft, Percent, Gift, Ticket } from "lucide-vue-next";
import { formatFloat } from "@/lib/format";
import { useOffersStore } from "@/stores/offers";
import { useUiStore } from "@/stores/ui";

const offers = useOffersStore();
const ui = useUiStore();

function describe(offer: { offer: string; discount_percentage?: number; discount_amount?: number; rate?: number }) {
	if (offer.discount_percentage) return `${formatFloat(offer.discount_percentage, 2)}% off`;
	if (offer.discount_amount) return `${formatFloat(offer.discount_amount, 2)} off`;
	if (offer.rate) return `Rate ${formatFloat(offer.rate, 2)}`;
	return offer.offer;
}
</script>

<template>
	<section class="panel flex h-full min-h-0 flex-col overflow-hidden">
		<header class="flex shrink-0 items-center gap-2 border-b border-line p-3">
			<button
				type="button"
				class="grid size-9 place-items-center rounded-card text-muted transition hover:bg-surface-2 hover:text-fg"
				aria-label="Back to catalog"
				@click="ui.setWorkspace('catalog')"
			>
				<ArrowLeft class="size-4.5" />
			</button>
			<h2 class="text-sm font-semibold">Offers</h2>
			<span class="ml-auto text-xs text-subtle">{{ offers.appliedCount }} applied</span>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto p-3">
			<div
				v-if="!offers.eligible.length"
				class="flex h-full flex-col items-center justify-center gap-2 text-center"
			>
				<Percent class="size-8 text-subtle" />
				<p class="text-sm font-medium">No offers apply yet</p>
				<p class="max-w-xs text-xs text-muted">Add more to the cart and eligible offers appear here.</p>
			</div>

			<ul v-else class="space-y-2">
				<li
					v-for="(offer, i) in offers.eligible"
					:key="offer.row_id"
					class="stagger flex items-start gap-3 rounded-card border border-line bg-surface p-3 shadow-xs"
					:style="{ '--i': i }"
				>
					<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-violet-soft text-violet">
						<Gift v-if="offer.offer === 'Give Product'" class="size-4" />
						<Ticket v-else-if="offer.coupon_based" class="size-4" />
						<Percent v-else class="size-4" />
					</span>

					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{{ offer.title || offer.name }}</p>
						<p class="text-[11px] text-subtle">{{ offer.offer }} · {{ describe(offer) }}</p>
						<p v-if="offer.description" class="mt-0.5 line-clamp-2 text-xs text-muted">
							{{ offer.description }}
						</p>
					</div>

					<label class="relative mt-0.5 inline-flex shrink-0 cursor-pointer items-center">
						<input
							type="checkbox"
							class="peer sr-only"
							:checked="offers.enabled.has(offer.row_id)"
							@change="offers.toggle(offer.row_id, ($event.target as HTMLInputElement).checked)"
						/>
						<span
							class="h-5 w-9 rounded-full bg-surface-3 transition after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-surface after:shadow-sm after:transition peer-checked:bg-accent peer-checked:after:translate-x-4"
						/>
					</label>
				</li>
			</ul>
		</div>
	</section>
</template>
