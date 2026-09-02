# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import frappe
import json
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class POSClosingShift(Document):
	def validate(self):
		user = frappe.get_all(
			"POS Closing Shift",
			filters={
				"user": self.user,
				"docstatus": 1,
				"pos_opening_shift": self.pos_opening_shift,
				"name": ["!=", self.name],
			},
		)

		if user:
			frappe.throw(
				_(
					"POS Closing Shift {} against {} between selected period".format(
						frappe.bold("already exists"), frappe.bold(self.user)
					)
				),
				title=_("Invalid Period"),
			)

		if (
			frappe.db.get_value("POS Opening Shift", self.pos_opening_shift, "status")
			!= "Open"
		):
			frappe.throw(
				_("Selected POS Opening Shift should be open."),
				title=_("Invalid Opening Entry"),
			)
		self.update_payment_reconciliation()

	def update_payment_reconciliation(self):
		# update the difference values in Payment Reconciliation child table
		# get default precision for site
		precision = (
			frappe.get_cached_value("System Settings", None, "currency_precision") or 3
		)
		for d in self.payment_reconciliation:
			d.difference = +flt(d.closing_amount, precision) - flt(
				d.expected_amount, precision
			)

	def on_submit(self):
		
		opening_entry = frappe.get_doc("POS Opening Shift", self.pos_opening_shift)
		opening_entry.pos_closing_shift = self.name
		opening_entry.set_status()
		# self.delete_draft_invoices()
		opening_entry.save()

	def delete_draft_invoices(self):
		if frappe.get_value("POS Profile", self.pos_profile, "posa_allow_delete"):
			data = frappe.db.sql(
				"""
				select
					name
				from
					`tabSales Invoice`
				where
					docstatus = 0 and posa_is_printed = 0 and posa_pos_opening_shift = %s
				""",
				(self.pos_opening_shift),
				as_dict=1,
			)

			for invoice in data:
				frappe.delete_doc("Sales Invoice", invoice.name, force=1)

	def cancel_draft_invoices(self, draft_invoices_with_cancellation_reason = None):
		data = frappe.db.sql(
			"""
			SELECT name
			FROM `tabSales Invoice`
			WHERE docstatus = 0
				AND posa_is_printed = 0
				AND posa_pos_opening_shift = %s
			""",
			(self.pos_opening_shift,),
			as_dict=1,
		)

		for invoice in data:
			doc = frappe.get_doc("Sales Invoice", invoice.name)
			doc.flags.ignore_validate = True
			reason = draft_invoices_with_cancellation_reason.get(invoice.name) if draft_invoices_with_cancellation_reason else None


			if not reason:
				frappe.throw(_("Please provide a reason for cancellation for invoice {}").format(invoice.name))

			
			if reason and not frappe.db.exists("Reason For Cancellation", {"reason": reason}):
				reason_doc = frappe.get_doc(
					{
						"doctype": "Reason For Cancellation",
						"reason": reason,
					}
				)
				reason_doc.insert(ignore_permissions=True)
			
			if not frappe.db.exists("Reason For Cancellation", {"reason": reason}):
				frappe.throw(_("Please provide a valid reason for cancellation for invoice {}").format(invoice.name))
			
			frappe.log_error(f"invoice{invoice.name}, workflow_state: {doc.workflow_state}, reason: {reason}", "POS Closing Shift - Cancel Draft Invoices")
			if doc.workflow_state in ["Pending Credit Approval", "Pending Discount Approval"]:
				self.mark_single_invoice_not_approved(doc.name, reason)
			else:
				doc.custom_pos_reason_for_cancellation = reason
				doc.flags.ignore_permissions = True
				doc.submit()
				doc.cancel()


	
	def mark_single_invoice_not_approved(self, sales_invoice_name: str, reason: str | None = None):
		doc = frappe.get_doc("Sales Invoice", sales_invoice_name)

		if not doc.workflow_state:
			return
		
		doc.db_set("workflow_state", "Not Approved", update_modified=True)
		if reason:
			doc.custom_pos_reason_for_cancellation = reason
			doc.db_set("custom_pos_reason_for_cancellation", reason, update_modified=True)
	
	def mark_invoices_not_approved(self, reason: str | None = None):
		invoices = frappe.get_all(
			"Sales Invoice",
			filters={
				"posa_pos_opening_shift": self.pos_opening_shift,
				"docstatus": 1,
				"workflow_state": ["in", ("Pending Credit Approval", "Pending Discount Approval")],
			},
			fields=["name"],
		)

		for invoice in invoices:
			self.mark_single_invoice_not_approved(invoice.name, reason)
	

	
	@frappe.whitelist()
	def get_payment_reconciliation_details(self):
		currency = frappe.get_cached_value("Company", self.company, "default_currency")
		return frappe.render_template(
			"posawesome/posawesome/doctype/pos_closing_shift/closing_shift_details.html",
			{"data": self, "currency": currency},
		)


@frappe.whitelist()
def get_cashiers(doctype, txt, searchfield, start, page_len, filters):
	cashiers_list = frappe.get_all("POS Profile User", filters=filters, fields=["user"])
	return [c["user"] for c in cashiers_list]


@frappe.whitelist()
def get_pos_invoices(pos_opening_shift):
	submit_printed_invoices(pos_opening_shift)
	data = frappe.db.sql(
		"""
	select
		name
	from
		`tabSales Invoice`
	where
		docstatus = 1 and posa_pos_opening_shift = %s
	""",
		(pos_opening_shift),
		as_dict=1,
	)

	data = [frappe.get_doc("Sales Invoice", d.name).as_dict() for d in data]

	return data


@frappe.whitelist()
def get_payments_entries(pos_opening_shift):
	return frappe.get_all(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"reference_no": pos_opening_shift,
			"payment_type": "Receive",
		},
		fields=[
			"name",
			"mode_of_payment",
			"paid_amount",
			"reference_no",
			"posting_date",
			"party",
		],
	)


@frappe.whitelist()
def make_closing_shift_from_opening(opening_shift, draft_invoices_with_cancellation_reason=None):
	opening_shift = json.loads(opening_shift)
	submit_printed_invoices(opening_shift.get("name"))
	closing_shift = frappe.new_doc("POS Closing Shift")
	closing_shift.pos_opening_shift = opening_shift.get("name")
	closing_shift.period_start_date = opening_shift.get("period_start_date")
	closing_shift.period_end_date = frappe.utils.get_datetime()
	closing_shift.pos_profile = opening_shift.get("pos_profile")
	closing_shift.user = opening_shift.get("user")
	closing_shift.company = opening_shift.get("company")
	closing_shift.grand_total = 0
	closing_shift.net_total = 0
	closing_shift.total_quantity = 0

	invoices = get_pos_invoices(opening_shift.get("name"))

	pos_transactions = []
	taxes = []
	payments = []
	pos_payments_table = []
	for detail in opening_shift.get("balance_details"):
		payments.append(
			frappe._dict(
				{
					"mode_of_payment": detail.get("mode_of_payment"),
					"opening_amount": detail.get("amount") or 0,
					"expected_amount": detail.get("amount") or 0,
				}
			)
		)

	for d in invoices:
		pos_transactions.append(
			frappe._dict(
				{
					"sales_invoice": d.name,
					"posting_date": d.posting_date,
					"grand_total": d.grand_total,
					"customer": d.customer,
				}
			)
		)
		closing_shift.grand_total += flt(d.grand_total)
		closing_shift.net_total += flt(d.net_total)
		closing_shift.total_quantity += flt(d.total_qty)

		for t in d.taxes:
			existing_tax = [
				tx
				for tx in taxes
				if tx.account_head == t.account_head and tx.rate == t.rate
			]
			if existing_tax:
				existing_tax[0].amount += flt(t.tax_amount)
			else:
				taxes.append(
					frappe._dict(
						{
							"account_head": t.account_head,
							"rate": t.rate,
							"amount": t.tax_amount,
						}
					)
				)

		for p in d.payments:
			existing_pay = [
				pay for pay in payments if pay.mode_of_payment == p.mode_of_payment
			]
			if existing_pay:
				cash_mode_of_payment = frappe.get_value(
					"POS Profile",
					opening_shift.get("pos_profile"),
					"posa_cash_mode_of_payment",
				)
				if not cash_mode_of_payment:
					cash_mode_of_payment = "Cash"
				if existing_pay[0].mode_of_payment == cash_mode_of_payment:
					amount = p.amount - d.change_amount
				else:
					amount = p.amount
				existing_pay[0].expected_amount += flt(amount)
			else:
				payments.append(
					frappe._dict(
						{
							"mode_of_payment": p.mode_of_payment,
							"opening_amount": 0,
							"expected_amount": p.amount,
						}
					)
				)

	pos_payments = get_payments_entries(opening_shift.get("name"))

	for py in pos_payments:
		pos_payments_table.append(
			frappe._dict(
				{
					"payment_entry": py.name,
					"mode_of_payment": py.mode_of_payment,
					"paid_amount": py.paid_amount,
					"posting_date": py.posting_date,
					"customer": py.party,
				}
			)
		)
		existing_pay = [
			pay for pay in payments if pay.mode_of_payment == py.mode_of_payment
		]
		if existing_pay:
			existing_pay[0].expected_amount += flt(py.paid_amount)
		else:
			payments.append(
				frappe._dict(
					{
						"mode_of_payment": py.mode_of_payment,
						"opening_amount": 0,
						"expected_amount": py.paid_amount,
					}
				)
			)

	closing_shift.set("pos_transactions", pos_transactions)
	closing_shift.set("payment_reconciliation", payments)
	closing_shift.set("taxes", taxes)
	closing_shift.set("pos_payments", pos_payments_table)

	if draft_invoices_with_cancellation_reason:
		draft_invoices_with_cancellation_reason = json.loads(
			draft_invoices_with_cancellation_reason
		)
		closing_shift.cancel_draft_invoices(
			draft_invoices_with_cancellation_reason
		)

	return closing_shift


@frappe.whitelist()
def submit_closing_shift(closing_shift):
	closing_shift = json.loads(closing_shift)
	closing_shift_doc = frappe.get_doc(closing_shift)
	closing_shift_doc.flags.ignore_permissions = True
	closing_shift_doc.save()
	closing_shift_doc.submit()
	return closing_shift_doc.name


def submit_printed_invoices(pos_opening_shift):
	invoices_list = frappe.get_all(
		"Sales Invoice",
		filters={
			"posa_pos_opening_shift": pos_opening_shift,
			"docstatus": 0,
			"posa_is_printed": 1,
		},
	)
	for invoice in invoices_list:
		invoice_doc = frappe.get_doc("Sales Invoice", invoice.name)
		invoice_doc.submit()
