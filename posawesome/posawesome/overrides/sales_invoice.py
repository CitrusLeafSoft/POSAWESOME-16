"""Sales Invoice doctype-class override.

ERPNext posts POS payment-mode legs (``make_pos_gl_entries``) without a party.
That is fine while the mode routes to a cash/bank asset or liability account, but
it fails hard once a receipt is taken through a POS Payment Method whose account is
a *Receivable* account: ``GL Entry.check_mandatory`` requires a party on any
Receivable/Payable line and throws "Customer/Supplier is required...".

POS Awesome lets a shop take money through a payment mode that backs onto the
customer's receivable (a "Credit Amount" / store-credit mode). To let that post, we
inject the invoice's party onto those GL entry lines after ERPNext builds them.
"""

import frappe
from frappe.utils import flt
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice


class PosaSalesInvoice(SalesInvoice):
	def make_pos_gl_entries(self, gl_entries):
		super().make_pos_gl_entries(gl_entries)

		# A return is receivable from the customer too; a mode-backed receivable is
		# still a customer line. Resolve the party for each account type once.
		for gle in gl_entries:
			account = gle.get("account")
			if not account or gle.get("party"):
				continue

			account_type = frappe.get_cached_value("Account", account, "account_type")
			if account_type == "Receivable":
				if self.customer:
					gle["party_type"] = "Customer"
					gle["party"] = self.customer
			elif account_type == "Payable":
				if self.supplier:
					gle["party_type"] = "Supplier"
					gle["party"] = self.supplier

def update_quotation_status(doc, method=None):
	if doc.docstatus != 1:
		return
	_recalculate_quotation_status(doc)


def update_quotation_status_on_cancel(doc, method=None):
	"""A cancelled invoice releases its quantity again, so the quotation can go
	back to Partially Invoiced (or Open) instead of staying stuck on Invoiced."""
	_recalculate_quotation_status(doc)


def _recalculate_quotation_status(doc):
	quotation_id = doc.get("custom_pos_quotation")

	if not quotation_id:
		return

	if not frappe.db.exists("Quotation", quotation_id):
		return

	from posawesome.posawesome.api.quotation import (
		get_invoiced_stock_qty,
		item_stock_qty,
	)

	quotation = frappe.get_doc("Quotation", quotation_id)
	invoiced = get_invoiced_stock_qty(quotation_id)

	# Compare cumulative submitted quantities, not just this invoice, so a
	# quotation split over several invoices reaches "Invoiced" only once every
	# line has been covered.
	quotation_stock = {}
	for row in quotation.items:
		quotation_stock[row.item_code] = quotation_stock.get(row.item_code, 0) + item_stock_qty(row)

	has_remaining = any(
		flt(invoiced.get(item_code)) < flt(qty) - 0.000001
		for item_code, qty in quotation_stock.items()
	)

	frappe.db.set_value(
		"Quotation",
		quotation_id,
		{
			"status": "Partially Invoiced" if has_remaining else "Invoiced",
			"order_type": "Sales",
		},
	)