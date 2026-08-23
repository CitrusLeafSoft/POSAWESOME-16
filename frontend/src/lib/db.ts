/**
 * Offline store.
 *
 * Three concerns live here:
 *   1. A read-through cache of the catalog and customer list, so the POS opens and
 *      keeps selling when the network drops.
 *   2. A durable outbox of invoices captured while offline.
 *   3. Small key/value metadata (cache stamps, the active shift).
 *
 * Everything is namespaced by POS profile — one terminal may be re-pointed at a
 * different profile and must not serve another profile's prices.
 */

import Dexie, { type EntityTable } from "dexie";
import type { Item, Customer } from "@/types";

export interface CachedItem extends Item {
	/** `${profile}::${item_code}` */
	key: string;
	profile: string;
	/** Lowercased haystack so offline search does not rebuild strings per keystroke. */
	search: string;
	cached_at: number;
}

export interface CachedCustomer extends Customer {
	key: string;
	profile: string;
	search: string;
	cached_at: number;
}

export type QueueStatus = "pending" | "syncing" | "failed" | "done";

export interface QueuedInvoice {
	/** Client-generated UUID; doubles as the server-side idempotency key. */
	uuid: string;
	profile: string;
	shift: string;
	created_at: number;
	updated_at: number;
	status: QueueStatus;
	attempts: number;
	last_error?: string;
	/** Human-readable summary for the pending-sync list. */
	summary: { customer: string; customer_name: string; grand_total: number; currency: string; item_count: number };
	/** The exact arguments submit_invoice would have received online. */
	payload: { invoice: Record<string, unknown>; data: Record<string, unknown> };
	/** Server document name once the entry has been accepted. */
	server_name?: string;
}

export interface MetaRow {
	key: string;
	value: unknown;
	updated_at: number;
}

class PosDatabase extends Dexie {
	items!: EntityTable<CachedItem, "key">;
	customers!: EntityTable<CachedCustomer, "key">;
	queue!: EntityTable<QueuedInvoice, "uuid">;
	meta!: EntityTable<MetaRow, "key">;

	constructor() {
		super("posawesome");
		this.version(1).stores({
			items: "key, profile, item_code, item_group, search",
			customers: "key, profile, name, search",
			queue: "uuid, profile, status, created_at",
			meta: "key",
		});
	}
}

export const db = new PosDatabase();

/** Raised when the queue cannot be written. Never swallowed — see enqueueInvoice. */
export class StorageUnavailableError extends Error {
	constructor(cause?: unknown) {
		super("This terminal's offline storage is not available");
		this.name = "StorageUnavailableError";
		this.cause = cause;
	}
}

/** Dexie throws in private-browsing / disabled-storage contexts; degrade quietly. */
let storageUsable: boolean | null = null;

/**
 * Opening can also *hang* rather than fail — a blocked upgrade, or a browser that
 * neither grants nor refuses the request. Without a ceiling every caller awaits
 * forever, which looks exactly like a frozen till.
 */
const OPEN_TIMEOUT_MS = 4000;

export async function isStorageUsable(): Promise<boolean> {
	if (storageUsable !== null) return storageUsable;
	try {
		await Promise.race([
			db.open(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("IndexedDB open timed out")), OPEN_TIMEOUT_MS),
			),
		]);
		storageUsable = true;
	} catch {
		storageUsable = false;
	}
	return storageUsable;
}

async function guard<T>(work: () => Promise<T>, fallback: T): Promise<T> {
	if (!(await isStorageUsable())) return fallback;
	try {
		return await work();
	} catch (error) {
		console.warn("[posa] offline store unavailable", error);
		return fallback;
	}
}

/* -------------------------------------------------------------------------- */
/* Catalog cache                                                               */
/* -------------------------------------------------------------------------- */

function itemHaystack(item: Item): string {
	return [item.item_code, item.item_name, item.item_group, item.brand, ...(item.item_barcode ?? []).map((b) => b.barcode)]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

export async function cacheItems(profile: string, items: Item[]): Promise<void> {
	await guard(async () => {
		const now = Date.now();
		const rows: CachedItem[] = items.map((item) => ({
			...item,
			key: `${profile}::${item.item_code}`,
			profile,
			search: itemHaystack(item),
			cached_at: now,
		}));
		await db.transaction("rw", db.items, db.meta, async () => {
			await db.items.where("profile").equals(profile).delete();
			await db.items.bulkPut(rows);
			await db.meta.put({ key: `items:${profile}`, value: now, updated_at: now });
		});
	}, undefined);
}

export async function readCachedItems(profile: string): Promise<Item[]> {
	return guard(() => db.items.where("profile").equals(profile).toArray(), [] as Item[]);
}

export async function cacheCustomers(profile: string, customers: Customer[]): Promise<void> {
	await guard(async () => {
		const now = Date.now();
		const rows: CachedCustomer[] = customers.map((customer) => ({
			...customer,
			key: `${profile}::${customer.name}`,
			profile,
			search: [customer.name, customer.customer_name, customer.mobile_no, customer.tax_id, customer.email_id]
				.filter(Boolean)
				.join(" ")
				.toLowerCase(),
			cached_at: now,
		}));
		await db.transaction("rw", db.customers, db.meta, async () => {
			await db.customers.where("profile").equals(profile).delete();
			await db.customers.bulkPut(rows);
			await db.meta.put({ key: `customers:${profile}`, value: now, updated_at: now });
		});
	}, undefined);
}

export async function readCachedCustomers(profile: string): Promise<Customer[]> {
	return guard(() => db.customers.where("profile").equals(profile).toArray(), [] as Customer[]);
}

export async function cacheStamp(kind: "items" | "customers", profile: string): Promise<number | null> {
	const row = await guard(() => db.meta.get(`${kind}:${profile}`), undefined);
	return (row?.value as number) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Outbox                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Store one completed-but-unsent sale.
 *
 * The only write in this file that must not fail quietly. Everything else here is a
 * cache — losing it costs a round trip. Losing this loses a sale whose money is
 * already in the drawer, so failure is raised rather than swallowed and the caller
 * is expected to tell the cashier.
 */
export async function enqueueInvoice(entry: QueuedInvoice): Promise<void> {
	if (!(await isStorageUsable())) throw new StorageUnavailableError();
	try {
		await db.queue.put(entry);
	} catch (error) {
		throw new StorageUnavailableError(error);
	}
}

export async function listQueue(profile?: string): Promise<QueuedInvoice[]> {
	return guard(async () => {
		const rows = profile
			? await db.queue.where("profile").equals(profile).toArray()
			: await db.queue.toArray();
		return rows.sort((a, b) => a.created_at - b.created_at);
	}, [] as QueuedInvoice[]);
}

export async function pendingCount(profile?: string): Promise<number> {
	const rows = await listQueue(profile);
	return rows.filter((row) => row.status === "pending" || row.status === "failed").length;
}

export async function updateQueueEntry(uuid: string, patch: Partial<QueuedInvoice>): Promise<void> {
	await guard(() => db.queue.update(uuid, { ...patch, updated_at: Date.now() }), 0);
}

export async function removeQueueEntry(uuid: string): Promise<void> {
	await guard(() => db.queue.delete(uuid), undefined);
}

/** Drop synced entries older than a day so the outbox does not grow forever. */
export async function pruneQueue(maxAgeMs = 86_400_000): Promise<void> {
	await guard(async () => {
		const cutoff = Date.now() - maxAgeMs;
		await db.queue.where("status").equals("done").and((row) => row.updated_at < cutoff).delete();
	}, undefined);
}

/* -------------------------------------------------------------------------- */
/* Metadata                                                                    */
/* -------------------------------------------------------------------------- */

export async function readMeta<T>(key: string): Promise<T | null> {
	const row = await guard(() => db.meta.get(key), undefined);
	return (row?.value as T) ?? null;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
	await guard(() => db.meta.put({ key, value, updated_at: Date.now() }), undefined);
}

export async function clearProfileCache(profile: string): Promise<void> {
	await guard(async () => {
		await db.items.where("profile").equals(profile).delete();
		await db.customers.where("profile").equals(profile).delete();
		await db.meta.bulkDelete([`items:${profile}`, `customers:${profile}`]);
	}, undefined);
}
