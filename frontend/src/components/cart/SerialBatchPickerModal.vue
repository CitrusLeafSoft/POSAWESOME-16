<script setup lang="ts">
/** Pick the batch and serial numbers for a specific cart line. The chosen serial
 *  count is the quantity — qty can never exceed the serials available in the batch. */
import { computed, ref, watch } from "vue";
import { Check } from "lucide-vue-next";
import ModalShell from "@/components/common/ModalShell.vue";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import type { CartItem, SerialInfo } from "@/types";

const props = defineProps<{ line: CartItem }>();

const cart = useCartStore();
const ui = useUiStore();

const batches = computed(() => cart.serialBatchOptions(props.line).batches);

// Keep local state in sync with the (possibly re-hydrated) line.
const batchNo = ref(props.line.batch_no ?? "");
const chosen = ref<string[]>(cart.serialBatchOptions(props.line).serials.map((s) => s.serial_no));

watch(
	() => props.line.posa_row_id,
	() => {
		batchNo.value = props.line.batch_no ?? "";
		const opts = cart.serialBatchOptions(props.line);
		chosen.value = opts.serials.map((s) => s.serial_no);
	},
);

/** Serials visible in the grid — always fetched for the *selected* batch, so
 *  switching batch reveals that batch's serials. Sorted for stable picking. */
const allSerials = computed<SerialInfo[]>(() => cart.availableSerialsFor(props.line, batchNo.value));

const series = computed(() =>
	allSerials.value.map((s) => s.serial_no).sort((a, b) => a.localeCompare(b)),
);

/** Keep picking limited to the serials actually shown under this batch. */
watch(series, (visible) => {
	chosen.value = chosen.value.filter((no) => visible.includes(no));
});

function serialFor(no: string): SerialInfo {
	return (props.line.serial_no_data ?? []).find((s) => s.serial_no === no) ?? { serial_no: no };
}

function toggleSerial(serial: SerialInfo, event: Event) {
	const checked = (event.target as HTMLInputElement).checked;
	const no = serial.serial_no;
	if (checked) {
		if (!chosen.value.includes(no)) chosen.value = [...chosen.value, no];
	} else {
		chosen.value = chosen.value.filter((n) => n !== no);
	}
}

/** Let the cashier pick a different batch; serials reset until re-picked. */
function pickBatch(value: string) {
	batchNo.value = value;
	chosen.value = [];
}

function commit() {
	cart.setSerialBatch(props.line.posa_row_id, {
		batch_no: batchNo.value || null,
		serials: chosen.value,
	});
	ui.closeModal();
}
</script>

<template>
	<ModalShell :title="line.item_name" :subtitle="`${line.item_code} — pick batch & serial`" width="max-w-md"
		@close="ui.closeModal()">
		<div class="grid gap-4 p-4">
			<div v-if="line.has_batch_no" class="flex flex-col gap-1.5">
				<label class="text-[11px] font-semibold uppercase tracking-wide text-subtle"
					for="serbatch-batch">Batch</label>
				<select id="serbatch-batch" :value="batchNo"
					class="h-9 rounded-card border-line bg-surface px-2 text-sm shadow-xs focus:border-accent focus:ring-0"
					@change="pickBatch(($event.target as HTMLSelectElement).value)">
					<option value="" v-if="!line.has_serial_no">— No batch —</option>
					<option v-for="b in batches" :key="b.batch_no" :value="b.batch_no">
						{{ b.batch_no }}
					</option>
				</select>
			</div>

			<div v-if="line.has_serial_no" class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<p class="text-[11px] font-semibold uppercase tracking-wide text-subtle">Serial numbers</p>
					<p class="text-[11px] tnum text-muted">
						{{ chosen.length }} of {{ series.length }} available
					</p>
				</div>
				<div class="max-h-56 overflow-y-auto rounded-card border border-line">
					<label v-for="no in series" :key="no"
						class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition hover:bg-surface-2">
						<input type="checkbox" :checked="chosen.includes(no)"
							class="size-4 rounded border-line accent-accent"
							@change="toggleSerial(serialFor(no), $event)" />
						<span class="flex min-w-0 flex-1 items-center gap-2 font-mono">
							{{ no }}
							<span v-if="serialFor(no).batch_no && serialFor(no).batch_no !== batchNo"
								class="rounded bg-surface-3 px-1 text-[10px] text-subtle">
								{{ serialFor(no).batch_no }}
							</span>
						</span>
						<Check v-if="chosen.includes(no)" class="size-3.5 shrink-0 text-accent" />
					</label>
				</div>
				<p class="text-[11px] text-muted">
					Quantity becomes exactly the serial count you pick ({{ chosen.length }}).
					Either change quantity here, or use the cart to set it — but no more than the
					serials available in this batch.
				</p>
			</div>

			<div class="flex items-center justify-between rounded-card border border-line px-3 py-2 text-sm">
				<span class="text-muted">Quantity</span>
				<span class="font-bold tnum">{{ line.has_serial_no ? chosen.length : line.qty }}</span>
			</div>
		</div>

		<template #footer>
			<div class="flex gap-2">
				<button type="button"
					class="h-11 flex-1 rounded-card border border-line font-semibold text-muted transition hover:bg-surface-2"
					@click="ui.closeModal()">
					Cancel
				</button>
				<button type="button"
					class="h-11 flex-1 rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
					@click="commit">
					Apply
				</button>
			</div>
		</template>
	</ModalShell>
</template>