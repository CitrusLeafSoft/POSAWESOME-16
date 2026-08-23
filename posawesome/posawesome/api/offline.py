"""Offline sync.

Invoices captured while the terminal was offline arrive here in batches. Each entry
carries a client-generated UUID which is stored on the invoice, so a retry after a
half-failed batch cannot double-post: an entry whose UUID already exists is
reported back as already-synced instead of being created again.
"""

import frappe
from frappe import _
from frappe.utils import add_days, nowdate

from posawesome.posawesome.api.invoice_api import submit_invoice, update_invoice
from posawesome.posawesome.api.utils import as_dict, as_list, validate_shift_access

MAX_BATCH_SIZE = 25


@frappe.whitelist()
def sync_invoices(batch):
	"""Replay a batch of offline invoices. Returns one result per entry.

	Entries are processed independently: one failure does not abort the rest, so a
	single bad invoice cannot block a terminal from draining its queue.
	"""
	entries = as_list(batch)
	if len(entries) > MAX_BATCH_SIZE:
		frappe.throw(_("Too many invoices in one batch (max {0})").format(MAX_BATCH_SIZE))

	results = []
	for entry in entries:
		entry = as_dict(entry)
		uuid = entry.get("uuid")
		if not uuid:
			results.append({"uuid": None, "status": "error", "error": _("Missing sync id")})
			continue

		try:
			results.append(_sync_one(uuid, entry))
		except Exception as error:
			# Roll back only this entry's partial writes, then carry on.
			frappe.db.rollback()
			frappe.log_error(title=f"POS Awesome offline sync failed ({uuid})", message=frappe.get_traceback())
			results.append({"uuid": uuid, "status": "error", "error": str(error)})
		else:
			frappe.db.commit()

	return results


def _sync_one(uuid, entry):
	existing = frappe.db.get_value(
		"Sales Invoice", {"posa_offline_uuid": uuid}, ["name", "docstatus"], as_dict=True
	)
	if existing:
		# Already landed on a previous attempt.
		return {
			"uuid": uuid,
			"status": "duplicate",
			"name": existing.name,
			"docstatus": existing.docstatus,
		}

	invoice_data = as_dict(entry.get("invoice"))
	submit_data = as_dict(entry.get("data"))

	validate_shift_access(invoice_data.get("posa_pos_opening_shift"))

	invoice_data["posa_offline_uuid"] = uuid

	# A client-generated name would collide with whatever the site has already issued,
	# so it is dropped — *unless* it names a draft this site really did create. That
	# happens when the connection died between saving the draft and submitting it:
	# reusing it settles the sale the cashier actually took, instead of leaving an
	# orphaned draft behind next to a duplicate.
	claimed = invoice_data.pop("name", None)
	if claimed:
		existing_draft = frappe.db.get_value(
			"Sales Invoice",
			{"name": claimed, "docstatus": 0, "posa_pos_opening_shift": invoice_data.get("posa_pos_opening_shift")},
			"name",
		)
		if existing_draft:
			invoice_data["name"] = existing_draft

	draft = update_invoice(invoice_data)
	result = submit_invoice({"name": draft.name}, submit_data)

	return {"uuid": uuid, "status": "synced", "name": result.get("name"), "docstatus": result.get("status")}


def prune_expired_sync_log(days=30):
	"""Scheduled cleanup of stale error logs from failed syncs."""
	frappe.db.delete(
		"Error Log",
		{
			"method": ["like", "%POS Awesome offline sync%"],
			"creation": ["<", add_days(nowdate(), -days)],
		},
	)
