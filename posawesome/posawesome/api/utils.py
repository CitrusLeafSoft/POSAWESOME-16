"""Shared helpers for the POS Awesome API.

Everything that more than one endpoint module needs lives here: argument
normalisation, stock lookups, and the v16 serial/batch plumbing.
"""

import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, get_datetime, getdate, nowdate

__all__ = [
	"as_dict",
	"as_list",
	"get_stock_availability",
	"get_available_batches",
	"get_available_serial_nos",
	"apply_serial_batch_fields",
	"auto_select_batches",
	"validate_shift_access",
	"precision_settings",
]


# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------
# Whitelisted methods receive JSON strings when called from the browser and real
# objects when called from Python, so every entry point normalises first.


def as_dict(value, default=None):
	"""Coerce a whitelisted argument into a plain dict."""
	if value is None or value == "":
		return default if default is not None else {}
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except (ValueError, TypeError):
			frappe.throw(_("Malformed request payload"))
	if isinstance(value, frappe._dict):
		return value
	if isinstance(value, dict):
		return frappe._dict(value)
	frappe.throw(_("Expected an object, got {0}").format(type(value).__name__))


def as_list(value, default=None):
	"""Coerce a whitelisted argument into a list."""
	if value is None or value == "":
		return default if default is not None else []
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except (ValueError, TypeError):
			frappe.throw(_("Malformed request payload"))
	if isinstance(value, list | tuple):
		return list(value)
	frappe.throw(_("Expected a list, got {0}").format(type(value).__name__))


def precision_settings():
	"""Precision the client must use so its totals match the server's."""
	system_settings = frappe.get_cached_doc("System Settings")
	currency_precision = cint(system_settings.currency_precision) or 2
	float_precision = cint(system_settings.float_precision) or 3
	return {
		"currency_precision": currency_precision,
		"float_precision": float_precision,
		"number_format": system_settings.number_format or "#,###.##",
		"date_format": system_settings.date_format or "yyyy-mm-dd",
		"time_zone": system_settings.time_zone,
		# Without this the client's rounded total disagrees with the server's on
		# every .5 boundary, and the tendered amount is off by a whole unit.
		"rounding_method": system_settings.rounding_method or "Banker's Rounding",
	}


# ---------------------------------------------------------------------------
# Stock
# ---------------------------------------------------------------------------


def get_stock_availability(item_code, warehouse):
	"""Current qty of an item in a warehouse.

	Reads Bin rather than replaying the stock ledger: Bin is maintained by the same
	transactions and a single indexed row is dramatically cheaper than an ordered
	scan of Stock Ledger Entry, which is what the v14 implementation did per item.
	"""
	if not item_code or not warehouse:
		return 0.0
	return flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty"))


def get_stock_availability_bulk(item_codes, warehouse):
	"""Bin quantities for many items in one query. Returns {item_code: qty}."""
	if not item_codes or not warehouse:
		return {}
	rows = frappe.get_all(
		"Bin",
		filters={"item_code": ["in", list(item_codes)], "warehouse": warehouse},
		fields=["item_code", "actual_qty"],
	)
	return {row.item_code: flt(row.actual_qty) for row in rows}


# ---------------------------------------------------------------------------
# Serial numbers and batches (ERPNext v15+ model)
# ---------------------------------------------------------------------------
# v15 replaced the free-text serial_no/batch_no fields with the Serial and Batch
# Bundle document. A POS still wants to work in plain numbers, so we keep filling
# serial_no/batch_no and set use_serial_batch_fields=1; ERPNext then materialises
# the bundle itself on submit (see StockController.make_bundle_using_old_serial_
# batch_fields). Availability, however, must be read through the new APIs.


def get_available_batches(item_code, warehouse, posting_date=None):
	"""Batches with stock on hand, newest-usable first.

	Expired and disabled batches are filtered out, and reserved-for-POS quantities
	are already netted off by ERPNext's auto-batch resolver.
	"""
	from erpnext.stock.doctype.serial_and_batch_bundle.serial_and_batch_bundle import get_auto_batch_nos

	if not item_code or not warehouse:
		return []

	kwargs = frappe._dict(
		{
			"item_code": item_code,
			"warehouse": warehouse,
			"based_on": frappe.get_single_value("Stock Settings", "pick_serial_and_batch_based_on") or "FIFO",
			"posting_date": posting_date or nowdate(),
		}
	)

	try:
		rows = get_auto_batch_nos(kwargs) or []
	except Exception:
		frappe.log_error(title="POS Awesome: batch lookup failed", message=frappe.get_traceback())
		return []

	batch_names = [row.get("batch_no") for row in rows if row.get("batch_no")]
	if not batch_names:
		return []

	meta = {
		row.name: row
		for row in frappe.get_all(
			"Batch",
			filters={"name": ["in", batch_names]},
			fields=["name", "expiry_date", "manufacturing_date", "disabled", "posa_batch_price"],
		)
	}

	today = getdate(posting_date or nowdate())
	available = []
	for row in rows:
		batch_no = row.get("batch_no")
		detail = meta.get(batch_no)
		if not detail or detail.disabled:
			continue
		if detail.expiry_date and getdate(detail.expiry_date) < today:
			continue
		if flt(row.get("qty")) <= 0:
			continue
		available.append(
			{
				"batch_no": batch_no,
				"batch_qty": flt(row.get("qty")),
				"expiry_date": detail.expiry_date,
				"manufacturing_date": detail.manufacturing_date,
				"batch_price": flt(detail.posa_batch_price) or None,
				"warehouse": row.get("warehouse") or warehouse,
			}
		)

	# Sell soonest-to-expire first; undated batches trail behind.
	available.sort(key=lambda b: (b["expiry_date"] is None, b["expiry_date"] or today))
	return available


def get_available_serial_nos(item_code, warehouse, limit=500):
	"""Serial numbers currently sitting in the warehouse."""
	if not item_code or not warehouse:
		return []
	return frappe.get_all(
		"Serial No",
		filters={"item_code": item_code, "warehouse": warehouse, "status": "Active"},
		fields=["name as serial_no", "warehouse", "batch_no"],
		order_by="creation asc",
		limit_page_length=limit,
	)


def auto_select_batches(item_code, warehouse, required_qty, posting_date=None):
	"""Pick batches to cover `required_qty`, soonest expiry first.

	Returns a list of ``{"batch_no", "qty"}``. Raises if stock cannot cover the
	requirement, matching the behaviour of the v14 ``set_batch_nos`` this replaces.
	"""
	required_qty = flt(required_qty)
	if required_qty <= 0:
		return []

	picked = []
	remaining = required_qty
	for batch in get_available_batches(item_code, warehouse, posting_date):
		if remaining <= 0:
			break
		take = min(remaining, flt(batch["batch_qty"]))
		if take <= 0:
			continue
		picked.append({"batch_no": batch["batch_no"], "qty": take})
		remaining -= take

	if remaining > 0:
		frappe.throw(
			_("Not enough stock in batches for item {0} in {1}. Short by {2}.").format(
				frappe.bold(item_code), frappe.bold(warehouse), flt(remaining)
			),
			title=_("Insufficient Batch Stock"),
		)

	return picked


def apply_serial_batch_fields(doc, auto_set_batch=False):
	"""Prepare every stock row of `doc` for ERPNext's bundle builder.

	Rows that carry a serial_no or batch_no are flagged with
	``use_serial_batch_fields`` so ERPNext creates the Serial and Batch Bundle at
	submit time. When `auto_set_batch` is on, batched rows that the cashier left
	blank are filled from available stock.

	A row needing more than one batch cannot be expressed in a single line, so it is
	split — this is the v16 equivalent of what ``set_batch_nos`` used to do.
	"""
	if doc.get("is_return"):
		# Returns reference the batches of the original sale; never auto-pick.
		auto_set_batch = False

	for table in ("items", "packed_items"):
		rows = doc.get(table) or []
		if not rows:
			continue
		_apply_to_table(doc, table, rows, auto_set_batch)


def _apply_to_table(doc, table, rows, auto_set_batch):
	extra_rows = []

	for row in rows:
		item_code = row.get("item_code")
		if not item_code:
			continue

		has_batch_no, has_serial_no = frappe.get_cached_value(
			"Item", item_code, ["has_batch_no", "has_serial_no"]
		)
		if not has_batch_no and not has_serial_no:
			continue

		if row.get("serial_and_batch_bundle"):
			# Already resolved (e.g. fetched from a Sales Order); leave it alone.
			continue

		if row.get("serial_no") or row.get("batch_no"):
			row.use_serial_batch_fields = 1
			continue

		if not (has_batch_no and auto_set_batch):
			continue

		warehouse = row.get("warehouse") or doc.get("set_warehouse")
		qty = abs(flt(row.get("stock_qty")) or flt(row.get("qty")))
		if not warehouse or qty <= 0:
			continue

		picked = auto_select_batches(item_code, warehouse, qty, doc.get("posting_date"))
		if not picked:
			continue

		conversion_factor = flt(row.get("conversion_factor")) or 1.0
		row.batch_no = picked[0]["batch_no"]
		row.use_serial_batch_fields = 1
		row.qty = flt(picked[0]["qty"]) / conversion_factor

		# Anything the first batch could not cover becomes its own line.
		for split in picked[1:]:
			clone = frappe.copy_doc(row) if hasattr(row, "as_dict") else frappe._dict(row)
			clone.name = None
			clone.batch_no = split["batch_no"]
			clone.qty = flt(split["qty"]) / conversion_factor
			clone.use_serial_batch_fields = 1
			extra_rows.append(clone)

	if extra_rows:
		for clone in extra_rows:
			doc.append(table, clone.as_dict() if hasattr(clone, "as_dict") else clone)
		# Re-number so idx stays contiguous after the splits.
		for idx, row in enumerate(doc.get(table), start=1):
			row.idx = idx


# ---------------------------------------------------------------------------
# Shift access
# ---------------------------------------------------------------------------


def validate_shift_access(opening_shift, user=None):
	"""Confirm the caller owns the shift they are acting on.

	POS endpoints run with elevated permissions so a cashier can write invoices
	without full Sales Invoice rights; the shift is what scopes that trust, so it
	has to be checked explicitly.
	"""
	if not opening_shift:
		frappe.throw(_("No POS Opening Shift supplied"), frappe.PermissionError)

	user = user or frappe.session.user
	shift = frappe.db.get_value(
		"POS Opening Shift",
		opening_shift,
		["name", "user", "status", "docstatus", "pos_profile", "company"],
		as_dict=True,
	)
	if not shift:
		frappe.throw(_("POS Opening Shift {0} not found").format(opening_shift))

	if shift.user != user and "System Manager" not in frappe.get_roles(user):
		frappe.throw(
			_("POS Opening Shift {0} belongs to another user").format(opening_shift),
			frappe.PermissionError,
		)

	if shift.docstatus != 1 or shift.status != "Open":
		frappe.throw(_("POS Shift {0} is not open").format(opening_shift))

	return shift


def get_pos_profile_for_shift(opening_shift):
	"""POS Profile document behind a shift, validated for the current user."""
	shift = validate_shift_access(opening_shift)
	return frappe.get_cached_doc("POS Profile", shift.pos_profile)


def check_pos_profile_access(pos_profile, user=None):
	"""Raise unless `user` is allowed to use `pos_profile`."""
	user = user or frappe.session.user
	if "System Manager" in frappe.get_roles(user):
		return
	allowed = frappe.get_all(
		"POS Profile User",
		filters={"parent": pos_profile, "user": user},
		limit=1,
		ignore_permissions=True,
	)
	if allowed:
		return
	# A profile with no user table is open to everyone who can read it.
	has_users = frappe.db.count("POS Profile User", {"parent": pos_profile})
	if has_users:
		frappe.throw(
			_("You are not allowed to use POS Profile {0}").format(pos_profile),
			frappe.PermissionError,
		)


def posting_datetime(doc):
	"""Combined posting datetime for a document, defaulting to now."""
	if doc.get("posting_date") and doc.get("posting_time"):
		return get_datetime(f"{doc.posting_date} {doc.posting_time}")
	return get_datetime()


def get_company_domain(company):
	"""Domain a company operates in; drives the Healthcare patient link."""
	return frappe.get_cached_value("Company", cstr(company), "domain")
