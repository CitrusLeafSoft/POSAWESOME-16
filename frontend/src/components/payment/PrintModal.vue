<script setup lang="ts">
/**
 * In-page print dialog — the v14 way.
 *
 * The invoice renders into a sandboxed iframe so format CSS cannot leak into
 * the POS, and printing targets that iframe's window, so the browser's print
 * sheet opens over the same page instead of a new tab.
 */
import { onMounted, ref, watch } from "vue";
import { Loader2, Printer } from "lucide-vue-next";
import { api } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

const props = defineProps<{ invoiceName: string }>();

const ui = useUiStore();

const formats = ref<string[]>([]);
const letterheads = ref<string[]>([]);
const printFormat = ref("");
const letterhead = ref<string>(""); // "" = no letterhead
const html = ref("");
const loading = ref(true);
const frame = ref<HTMLIFrameElement | null>(null);

async function loadOptions() {
	const options = await api.printOptions(props.invoiceName);
	formats.value = options.print_formats ?? [];
	letterheads.value = options.letterheads ?? [];
	printFormat.value = options.default_print_format ?? "";
	letterhead.value = options.default_letterhead ?? "";
}

async function loadPreview() {
	html.value = await api
		.printInvoice(props.invoiceName, printFormat.value || undefined, letterhead.value || null)
		.then((result) => result.html);
}

onMounted(async () => {
	try {
		await loadOptions();
		await loadPreview();
	} catch (error) {
		ui.fail("Could not load the receipt", error instanceof Error ? error.message : String(error));
	} finally {
		loading.value = false;
	}
});

watch([printFormat, letterhead], () => {
	void loadPreview().catch(() => ui.fail("Could not render that format"));
});

function print() {
	const win = frame.value?.contentWindow;
	if (!win) return;
	win.focus();
	win.print();
}
</script>

<template>
	<ModalShell title="Print receipt" :subtitle="invoiceName" width="max-w-3xl" @close="ui.closeModal()">
		<div v-if="loading" class="flex items-center justify-center gap-2 p-10 text-sm text-muted">
			<Loader2 class="size-4 animate-spin" /> Preparing the receipt…
		</div>

		<template v-else>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3">
				<label class="flex items-center gap-1.5 text-xs font-medium text-muted">
					Print Format
					<select
						v-model="printFormat"
						class="h-8 rounded-card border-line bg-surface py-0 text-xs shadow-xs focus:border-accent focus:ring-0"
					>
						<option v-for="format in formats" :key="format" :value="format">{{ format }}</option>
					</select>
				</label>

				<label class="flex items-center gap-1.5 text-xs font-medium text-muted">
					Letter Head
					<select
						v-model="letterhead"
						class="h-8 rounded-card border-line bg-surface py-0 text-xs shadow-xs focus:border-accent focus:ring-0"
					>
						<option value="">No Letterhead</option>
						<option v-for="head in letterheads" :key="head" :value="head">{{ head }}</option>
					</select>
				</label>
			</div>

			<!-- The preview is the thing being printed; keep it inside this page. -->
			<iframe
				ref="frame"
				title="Receipt preview"
				class="h-[52vh] w-full border-0 bg-surface-2"
				:srcdoc="html"
			/>
		</template>

		<template #footer>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card border border-line font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.closeModal()"
				>
					Close
				</button>
				<button
					type="button"
					class="flex h-11 items-center justify-center gap-2 rounded-card bg-accent font-semibold text-accent-fg transition hover:bg-accent-hover"
					:disabled="loading"
					@click="print"
				>
					<Printer class="size-4" />
					Print
				</button>
			</div>
		</template>
	</ModalShell>
</template>
