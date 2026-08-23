<script setup lang="ts">
/**
 * In-page print dialog.
 *
 * The receipt renders into a sandboxed iframe so format CSS cannot leak into the POS,
 * and printing targets that iframe's window, so the browser's print sheet opens over
 * the same page instead of in a new tab.
 *
 * Two things this has to get right, both of which used to be wrong:
 *
 * A `srcdoc` iframe has a base URL of `about:srcdoc`, so every site-relative link in
 * the rendered format — including Frappe's own print stylesheet — resolves to
 * nothing and the receipt prints unstyled. A <base> is injected for that reason.
 *
 * The format list is a convenience, not a prerequisite. If it fails to load, the
 * preview still renders on the server's own default rather than the dialog becoming
 * an empty box with nothing to print.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Loader2, Printer, TriangleAlert } from "lucide-vue-next";
import { api } from "@/lib/api";
import { useUiStore } from "@/stores/ui";
import ModalShell from "@/components/common/ModalShell.vue";

const props = defineProps<{ invoiceName: string }>();

const ui = useUiStore();

const formats = ref<string[]>([]);
const letterheads = ref<string[]>([]);
const printFormat = ref("");
const letterhead = ref(""); // "" = no letterhead
const html = ref("");
const loading = ref(true);
const rendering = ref(false);
/** True once the iframe has actually painted; printing before that prints blank. */
const ready = ref(false);
const error = ref("");
const frame = ref<HTMLIFrameElement | null>(null);

const canPrint = computed(() => ready.value && !!html.value && !rendering.value);

/**
 * Prepare Frappe's print page for use as an embedded preview.
 *
 * Two injections, both into <head>:
 *
 * A <base>, because a srcdoc iframe resolves relative URLs against about:srcdoc — so
 * the format's own stylesheet, Frappe's print bundle and any images all load from
 * nothing and the receipt renders as unstyled text.
 *
 * A stylesheet that drops the "action-banner": Frappe's print page carries its own
 * Print and Get PDF links, which belong to that page, not to the document. They are
 * marked print-hide so paper is unaffected, but on screen they sit above the receipt
 * looking like part of it — and this dialog already has its own Print button.
 */
const PREVIEW_CSS = `
<style>
	/* Frappe's own print-page chrome. Not part of the document being previewed. */
	.action-banner { display: none !important; }
	/* The gutter exists to mimic paper margins around an A4 page; on a receipt it
	   just wastes the width of the dialog. */
	.print-format-gutter { padding: 0 !important; background: transparent !important; }
</style>`;

function prepareForPreview(source: string): string {
	if (!source) return source;
	const head = `<base href="${window.location.origin}/">${PREVIEW_CSS}`;
	if (/<head[^>]*>/i.test(source)) {
		return source.replace(/<head([^>]*)>/i, `<head$1>${head}`);
	}
	return head + source;
}

async function loadOptions() {
	try {
		const options = await api.printOptions(props.invoiceName);
		formats.value = options.print_formats ?? [];
		letterheads.value = options.letterheads ?? [];
		printFormat.value = options.default_print_format ?? "";
		letterhead.value = options.default_letterhead ?? "";
	} catch {
		// Not fatal: an empty selector still leaves a printable receipt below.
		formats.value = [];
		letterheads.value = [];
	}
}

async function loadPreview() {
	rendering.value = true;
	ready.value = false;
	try {
		const result = await api.printInvoice(
			props.invoiceName,
			printFormat.value || undefined,
			letterhead.value || null,
		);
		html.value = prepareForPreview(result.html);
		// The server tells us what it actually used; reflect it so the selector is not
		// showing one format while another is on screen.
		if (result.print_format && !printFormat.value) printFormat.value = result.print_format;
		error.value = "";
	} catch (caught) {
		html.value = "";
		error.value = caught instanceof Error ? caught.message : String(caught);
	} finally {
		rendering.value = false;
	}
}

onMounted(async () => {
	await loadOptions();
	await loadPreview();
	loading.value = false;
});

// Reloading on a format change is the whole point of the selector, but the first
// render is already handled above, so skip while still starting up.
watch([printFormat, letterhead], () => {
	if (!loading.value) void loadPreview();
});

/** The sheet has been sent or dismissed; either way the dialog is done. */
function onAfterPrint() {
	ui.closeModal();
}

function onFrameLoad() {
	ready.value = true;
	const win = frame.value?.contentWindow;
	win?.addEventListener("afterprint", onAfterPrint);
}

onBeforeUnmount(() => {
	frame.value?.contentWindow?.removeEventListener("afterprint", onAfterPrint);
});

function print() {
	const win = frame.value?.contentWindow;
	if (!win || !canPrint.value) return;
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
			<div
				v-if="formats.length || letterheads.length"
				class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3"
			>
				<label v-if="formats.length" class="flex items-center gap-1.5 text-xs font-medium text-muted">
					Format
					<select
						v-model="printFormat"
						class="h-9 rounded-card border-line bg-surface py-0 text-xs shadow-xs focus:border-accent focus:ring-0"
					>
						<option v-for="format in formats" :key="format" :value="format">{{ format }}</option>
					</select>
				</label>

				<label v-if="letterheads.length" class="flex items-center gap-1.5 text-xs font-medium text-muted">
					Letter head
					<select
						v-model="letterhead"
						class="h-9 rounded-card border-line bg-surface py-0 text-xs shadow-xs focus:border-accent focus:ring-0"
					>
						<option value="">None</option>
						<option v-for="head in letterheads" :key="head" :value="head">{{ head }}</option>
					</select>
				</label>

				<span v-if="rendering" class="ms-auto inline-flex items-center gap-1.5 text-xs text-subtle">
					<Loader2 class="size-3.5 animate-spin" /> rendering
				</span>
			</div>

			<div
				v-if="error"
				class="m-5 flex items-start gap-2 rounded-card border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
			>
				<TriangleAlert class="mt-0.5 size-4 shrink-0" />
				<div>
					<p class="font-semibold">Could not render this format</p>
					<p class="mt-0.5 text-xs opacity-90">{{ error }}</p>
				</div>
			</div>

			<!-- The preview is the thing being printed; keep it inside this page. -->
			<iframe
				v-else
				ref="frame"
				title="Receipt preview"
				class="h-[52vh] w-full border-0 bg-white"
				:srcdoc="html"
				@load="onFrameLoad"
			/>
		</template>

		<template #footer>
			<div class="flex items-center justify-end gap-2">
				<button
					type="button"
					class="inline-flex h-11 items-center justify-center rounded-card border border-line px-4 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-fg"
					@click="ui.closeModal()"
				>
					Close
				</button>
				<button
					type="button"
					class="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-card bg-accent px-5 text-sm font-semibold text-accent-fg shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-subtle disabled:shadow-none"
					:disabled="!canPrint"
					@click="print"
				>
					<Loader2 v-if="loading || rendering" class="size-4 animate-spin" />
					<Printer v-else class="size-4" />
					{{ loading || rendering ? "Preparing…" : "Print" }}
				</button>
			</div>
		</template>
	</ModalShell>
</template>
