<script setup lang="ts">
import { computed, ref } from "vue";
import { Minus, Plus, Tag, Trash2, Gift, StickyNote, Boxes } from "lucide-vue-next";
import { formatCurrency, formatFloat, toNumber } from "@/lib/format";
import { useCartStore } from "@/stores/cart";
import { useSessionStore } from "@/stores/session";
import { useUiStore } from "@/stores/ui";
import type { CartItem } from "@/types";

const props = defineProps<{ line: CartItem }>();

const cart = useCartStore();
const session = useSessionStore();
const ui = useUiStore();

const selected = computed(() => cart.selectedRowId === props.line.posa_row_id);
const bumped = computed(() => cart.bumped.has(props.line.posa_row_id));
const canEditRate = computed(() => !!session.profile?.posa_allow_user_to_edit_rate);
const canEditDiscount = computed(() => !!session.profile?.posa_allow_user_to_edit_item_discount);
const hasDiscount = computed(() => toNumber(props.line.discount_percentage) > 0);

const editingQty = ref(false);

/** Return lines carry negative quantities. The cashier should still see and type
 *  a plain count, so the sign lives here and never reaches the input. */
const lineSign = computed(() => (props.line.qty < 0 ? -1 : 1));
const displayQty = computed(() => formatFloat(Math.abs(props.line.qty)));

function commitQty(event: Event) {
	const typed = Math.abs(toNumber((event.target as HTMLInputElement).value));
	void cart.setQty(props.line.posa_row_id, lineSign.value * typed);
	editingQty.value = false;
}

function viewDetails() {
	cart.selectedRowId = props.line.posa_row_id;
	ui.openModal("lineDetails", { line: props.line });
}

function pickSerial() {
	cart.selectedRowId = props.line.posa_row_id;
	ui.openModal("serialBatch", { line: props.line });
}

/** One serial number per sold unit, shown as distinct chips. */
const serials = computed(() =>
	(props.line.serial_no ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
);
</script>

<template>
	<div
		class="group relative cursor-pointer px-3 py-2.5 transition"
		:class="[
			selected ? 'bg-accent-soft/45' : 'hover:bg-surface-2',
			bumped && 'animate-bump',
		]"
		@click="viewDetails"
	>
		<span
			v-if="selected"
			class="absolute inset-y-0 left-0 w-0.5 bg-accent"
			aria-hidden="true"
		/>

		<div class="flex items-start gap-2">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<Gift v-if="line.posa_is_offer" class="size-3.5 shrink-0 text-violet" title="From an offer" />
					<p class="truncate text-sm font-medium leading-tight">{{ line.item_name }}</p>
				</div>
				<div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-subtle">
					<span class="font-mono">{{ line.item_code }}</span>
					<span v-if="line.uom !== line.stock_uom" class="rounded bg-surface-3 px-1">{{ line.uom }}</span>
					<span v-if="line.custom_nlc" class="rounded bg-surface-3 px-1" title="NLC">NLC {{ formatCurrency(line.custom_nlc) }}</span>
					<span v-if="line.custom_rsp" class="rounded bg-surface-3 px-1" title="RSP">RSP {{ formatCurrency(line.custom_rsp) }}</span>
<span v-if="line.batch_no" class="rounded bg-surface-3 px-1" title="Batch">{{ line.batch_no }}</span>
					<span v-if="serials.length" class="flex flex-wrap gap-0.5">
						<span
							v-for="no in serials"
							:key="no"
							class="rounded bg-surface-3 px-1 font-mono"
							title="Serial"
						>{{ no }}</span>
					</span>
					<span v-if="hasDiscount" class="inline-flex items-center gap-0.5 text-success">
						<Tag class="size-2.5" />{{ formatFloat(line.discount_percentage, 2) }}%
					</span>
				</div>
			</div>

			<div class="shrink-0 text-right">
				<p class="text-sm font-bold tnum">{{ formatCurrency(line.amount) }}</p>
				<p class="text-[11px] tnum text-subtle">
					<span class="text-muted">Sale</span> {{ formatCurrency(line.price_list_rate) }}
				</p>
				<p v-if="hasDiscount" class="text-[11px] tnum text-subtle line-through">
					{{ formatCurrency(line.price_list_rate * line.qty) }}
				</p>
			</div>

			<button
				type="button"
				class="grid size-7 shrink-0 place-items-center rounded-lg text-subtle opacity-0 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
				:class="selected && 'opacity-100'"
				aria-label="Remove line"
				@click.stop="cart.removeItem(line.posa_row_id)"
			>
				<Trash2 class="size-3.5" />
			</button>
		</div>

		<!-- Controls, revealed for the selected line -->
		<div v-if="selected" class="mt-2 flex flex-wrap items-center gap-2 animate-fade-in">
			<div class="flex items-center rounded-card border border-line bg-surface shadow-xs">
				<button
					type="button"
					class="grid size-8 place-items-center rounded-l-card text-muted transition hover:bg-surface-2 hover:text-fg"
					aria-label="Decrease quantity"
					@click.stop="cart.stepQty(line.posa_row_id, -1)"
				>
					<Minus class="size-3.5" />
				</button>
				<input
					:value="displayQty"
					type="text"
					inputmode="decimal"
					class="h-8 w-14 border-0 bg-transparent p-0 text-center text-sm font-semibold tnum focus:ring-0"
					aria-label="Quantity"
					@click.stop
					@focus="editingQty = true"
					@change="commitQty"
					@keydown.enter="commitQty"
				/>
				<button
					type="button"
					class="grid size-8 place-items-center rounded-r-card text-muted transition hover:bg-surface-2 hover:text-fg"
					aria-label="Increase quantity"
					@click.stop="cart.stepQty(line.posa_row_id, 1)"
				>
					<Plus class="size-3.5" />
				</button>
			</div>

			<button
				v-if="line.has_serial_no || line.has_batch_no"
				type="button"
				class="inline-flex h-8 items-center gap-1.5 rounded-card border border-line bg-surface px-3 text-xs font-medium text-muted transition hover:text-fg"
				title="Pick batch / serial numbers"
				@click.stop="pickSerial"
			>
				<Boxes class="size-3.5" />
				{{ line.has_serial_no ? "Serials" : "Batch" }}
			</button>

			<label class="flex items-center gap-1.5 text-[11px] text-subtle">
				Rate
				<input
					:value="formatFloat(line.rate, 2)"
					type="text"
					inputmode="decimal"
					:disabled="!canEditRate"
					class="h-8 w-20 rounded-card border-line bg-surface text-right text-sm tnum shadow-xs focus:border-accent focus:ring-0 disabled:bg-surface-2 disabled:text-subtle"
					@click.stop
					@change="cart.setRate(line.posa_row_id, toNumber(($event.target as HTMLInputElement).value))"
				/>
			</label>

			<label class="flex items-center gap-1.5 text-[11px] text-subtle">
				Disc %
				<input
					:value="formatFloat(line.discount_percentage, 2)"
					type="text"
					inputmode="decimal"
					:disabled="!canEditDiscount"
					class="h-8 w-16 rounded-card border-line bg-surface text-right text-sm tnum shadow-xs focus:border-accent focus:ring-0 disabled:bg-surface-2 disabled:text-subtle"
					@click.stop
					@change="
						cart.setLineDiscount(
							line.posa_row_id,
							toNumber(($event.target as HTMLInputElement).value),
							'percentage',
						)
					"
				/>
			</label>

			<select
				v-if="(line.item_uoms?.length ?? 0) > 1"
				:value="line.uom"
				class="h-8 rounded-card border-line bg-surface py-0 text-xs shadow-xs focus:border-accent focus:ring-0"
				aria-label="Unit of measure"
				@click.stop
				@change="cart.setUom(line.posa_row_id, ($event.target as HTMLSelectElement).value)"
			>
				<option v-for="option in line.item_uoms" :key="option.uom" :value="option.uom">
					{{ option.uom }}
				</option>
			</select>

			<div
				v-if="session.profile?.posa_display_additional_notes"
				class="flex min-w-0 flex-1 items-center gap-1.5"
			>
				<StickyNote class="size-3.5 shrink-0 text-subtle" />
				<input
					:value="line.posa_notes"
					type="text"
					placeholder="Note"
					class="h-8 min-w-0 flex-1 rounded-card border-line bg-surface text-xs shadow-xs focus:border-accent focus:ring-0"
					@click.stop
					@change="cart.setNotes(line.posa_row_id, ($event.target as HTMLInputElement).value)"
				/>
			</div>
		</div>
	</div>
</template>
