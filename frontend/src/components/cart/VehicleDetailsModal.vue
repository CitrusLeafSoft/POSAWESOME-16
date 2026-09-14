<script setup lang="ts">
import { onMounted, ref } from "vue";
import { X } from "lucide-vue-next";
import { api } from "@/lib/api";
import { useCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";
import VehicleComboBox from "@/components/cart/VehicleComboBox.vue";

const cart = useCartStore();
const ui = useUiStore();

const vehicleTypes = ref<{ name: string }[]>([]);
const vehicleModels = ref<{ name: string }[]>([]);
const optionsLoading = ref(false);

async function loadVehicleOptions() {
	optionsLoading.value = true;
	try {
		const data = await api.vehicleTypesModels();
		vehicleTypes.value = data.vehicle_types ?? [];
		vehicleModels.value = data.vehicle_models ?? [];
	} catch {
		// Offline or unavailable — the sale itself must not be blocked.
	} finally {
		optionsLoading.value = false;
	}
}

onMounted(() => {
	void loadVehicleOptions();
});

/** Any type/model typed that isn't in the master list yet gets created here, on close. */
async function createNewMastersOnClose() {
	const types = new Set<string>();
	const models = new Set<string>();
	for (const row of cart.vehicleDetails) {
		const type = (row.vehicle_type ?? "").trim();
		const model = (row.vehicle_model ?? "").trim();
		if (type && !vehicleTypes.value.some((opt) => opt.name === type)) types.add(type);
		if (model && !vehicleModels.value.some((opt) => opt.name === model)) models.add(model);
	}
	if (!types.size && !models.size) return;
	try {
		const data = await api.ensureVehicleTypeModel([...types], [...models]);
		vehicleTypes.value = data.vehicle_types ?? vehicleTypes.value;
		vehicleModels.value = data.vehicle_models ?? vehicleModels.value;
	} catch {
		// Master save failures are not fatal to the sale.
	}
}

async function closeModal() {
	await createNewMastersOnClose();
	ui.closeModal();
}

function sanitizeMileage(event: Event) {
	const input = event.target as HTMLInputElement;
	const cleaned = input.value.replace(/[^0-9.]/g, "");
	if (cleaned !== input.value) input.value = cleaned;
	const row = cart.vehicleDetails.find((entry) => entry.posa_row_id === (input.dataset.rowId ?? ""));
	if (row) row.vehicle_mileage = cleaned;
}
</script>

<template>
	<ModalShell title="Vehicle Details" subtitle="Vehicle information for this sale" width="max-w-2xl" @close="closeModal">
		<div class="p-4">
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<button type="button"
							class="h-8 rounded-card border border-line bg-surface px-3 text-xs font-semibold text-accent transition hover:bg-accent-soft"
							@click="cart.addVehicleRow">
							+ Add vehicle
						</button>
						<button type="button"
							class="h-8 rounded-card border border-line bg-surface px-3 text-xs font-medium text-muted transition hover:bg-surface-2 disabled:opacity-50"
							:disabled="optionsLoading" @click="loadVehicleOptions">
							{{ optionsLoading ? "Refreshing…" : "Refresh options" }}
						</button>
					</div>
					<span v-if="cart.vehicleDetails.length" class="text-xs text-subtle">
						{{ cart.vehicleDetails.length }} {{ cart.vehicleDetails.length === 1 ? "vehicle" : "vehicles" }}
					</span>
				</div>

				<div class="max-h-112 min-h-32 overflow-y-auto rounded-card border border-line">
					<table class="w-full text-xs">
						<thead>
							<tr class="sticky top-0 z-10 bg-surface-2 text-left">
								<th class="w-7 px-1.5 py-1.5 font-semibold text-subtle">#</th>
								<th class="min-w-24 px-1.5 py-1.5 font-semibold text-subtle">Vehicle Number</th>
								<th class="min-w-20 px-1.5 py-1.5 font-semibold text-subtle">Mileage</th>
								<th class="min-w-32 px-1.5 py-1.5 font-semibold text-subtle">Category</th>
								<th class="min-w-24 px-1.5 py-1.5 font-semibold text-subtle">Type</th>
								<th class="min-w-24 px-1.5 py-1.5 font-semibold text-subtle">Model</th>
								<th class="w-10 px-1.5 py-1.5" />
							</tr>
						</thead>
						<tbody>
							<tr v-for="(row, index) in cart.vehicleDetails" :key="row.posa_row_id"
								class="border-t border-line transition-colors hover:bg-surface-2/60">
								<td class="px-1.5 py-1 text-subtle">{{ index + 1 }}</td>
								<td class="px-1 py-0.5">
									<input v-model="row.vehicle_number" type="text" placeholder="Vehicle Number"
										:aria-label="`Vehicle ${index + 1} registration number`"
										class="h-7 w-full rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0" />
								</td>
								<td class="px-1 py-0.5">
									<div class="relative">
										<input :value="row.vehicle_mileage" type="text" inputmode="decimal" placeholder="0"
											:data-row-id="row.posa_row_id" :aria-label="`Vehicle ${index + 1} mileage in kilometres`"
											class="h-7 w-full rounded-card border-line bg-surface pr-6 text-sm shadow-xs focus:border-accent focus:ring-0"
											@input="sanitizeMileage($event)" />
										<span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-subtle">km</span>
									</div>
								</td>
								<td class="px-1 py-0.5">
									<select v-model="row.vehicle_category" :aria-label="`Vehicle ${index + 1} category`"
										class="h-7 w-full rounded-card border-line bg-surface text-sm shadow-xs focus:border-accent focus:ring-0">
										<option value="">—</option>
										<option value="Private">Private</option>
										<option value="Commercial">Commercial</option>
									</select>
								</td>
								<td class="px-1 py-0.5">
									<VehicleComboBox v-model="row.vehicle_type" :options="vehicleTypes" placeholder="Select or type"
										:aria-label="`Vehicle ${index + 1} type`" create-label="type" />
								</td>
								<td class="px-1 py-0.5">
									<VehicleComboBox v-model="row.vehicle_model" :options="vehicleModels" placeholder="Select or type"
										:aria-label="`Vehicle ${index + 1} model`" create-label="model" />
								</td>
								<td class="px-1 py-0.5">
									<button type="button"
										class="grid size-7 place-items-center rounded-card border border-line bg-surface text-danger transition hover:bg-danger-soft"
										:aria-label="`Remove vehicle ${index + 1}`" @click="cart.removeVehicleRow(row.posa_row_id)">
										<X class="size-3.5" />
									</button>
								</td>
							</tr>
							<tr v-if="!cart.vehicleDetails.length">
								<td colspan="7" class="px-2 py-6 text-center text-subtle">
									No vehicles yet. Add one to record its details.
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<p class="text-[11px] text-subtle">
					New types or models you type in are added to the list once you close this window.
				</p>
			</div>
		</div>

		<template #footer>
			<button type="button"
				class="h-11 w-full rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
				@click="closeModal">
				Done
			</button>
		</template>
	</ModalShell>
</template>