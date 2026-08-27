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