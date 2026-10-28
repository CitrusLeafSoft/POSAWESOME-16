from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, flt


@frappe.whitelist()
def search_quotations(search_value=None, limit=10):
	limit = min(max(cint(limit) or 10, 1), 50)
	or_filters = None
	if search_value:
		pattern = f"%{search_value}%"
		or_filters = {
			"name": ["like", pattern],
			"customer_name": ["like", pattern],
			"party_name": ["like", pattern],
		}

	return frappe.get_list(
		"Quotation",
		filters={
			"docstatus": ["=", 1],
			"quotation_to": "Customer",
			"status": ["not in", ["Expired", "Lost", "Cancelled", "Invoiced"]],
		},
		or_filters=or_filters,
		fields=[
			"name",
			"party_name as customer",
			"customer_name",
			"transaction_date",
			"grand_total",
			"currency",
			"status",
			"docstatus",
		],
		order_by="modified desc",
		limit_page_length=limit,
	)


@frappe.whitelist()
def get_quotation_details(quotation):
	if not quotation:
		frappe.throw(_("Quotation is required"))

	doc = frappe.get_doc("Quotation", quotation)
	doc.check_permission("read")

	if doc.quotation_to != "Customer":
		frappe.throw(_("Quotation {0} is not for a customer").format(quotation))
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted quotations can be sent to the POS."))
	if doc.status in ("Expired", "Lost", "Cancelled", "Invoiced"):
		frappe.throw(_("Quotation {0} is {1}").format(quotation, doc.status))

	invoiced = get_invoiced_stock_qty(quotation)

	# Work in stock UOM so a quotation line and an invoice line with different
	# transaction UOMs can still be compared. Duplicate item rows in one quotation
	# share the invoiced total; distribute it across the rows in order.
	quotation_stock = defaultdict(float)
	for row in doc.items:
		quotation_stock[row.item_code] += item_stock_qty(row)

	remaining = {
		item_code: max(total - flt(invoiced.get(item_code)), 0.0)
		for item_code, total in quotation_stock.items()
	}
	consumed = defaultdict(float)

	items = []
	for row in doc.items:
		factor = flt(row.conversion_factor) or 1
		available = max(remaining.get(row.item_code, 0.0) - consumed[row.item_code], 0.0)
		remaining_stock = min(item_stock_qty(row), available)
		consumed[row.item_code] += remaining_stock
		if remaining_stock <= 0.000001:
			# Fully invoiced already — never put an exhausted line in the cart.
			continue

		items.append(
			{
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": flt(remaining_stock / factor, row.precision("qty")),
				"quotation_qty": flt(row.qty),
				"uom": row.uom or row.stock_uom,
				"rate": flt(row.rate),
				"conversion_factor": factor,
				"warehouse": row.warehouse,
			}
		)

	if not items:
		frappe.throw(_("Quotation {0} has no remaining quantity to invoice.").format(quotation))

	return {
		"name": doc.name,
		"customer": doc.party_name,
		"customer_name": doc.customer_name,
		"currency": doc.currency,
		"selling_price_list": doc.selling_price_list,
		"transaction_date": doc.transaction_date,
		"grand_total": flt(doc.grand_total),
		"status": doc.status,
		"items": items,
	}


def item_stock_qty(row):
	"""A Quotation Item's quantity in stock UOM."""
	return flt(row.stock_qty) or flt(row.qty) * (flt(row.conversion_factor) or 1)


def get_invoiced_stock_qty(quotation):
	"""Net submitted Sales Invoice quantity per item for a quotation.

	The link is Sales Invoice.custom_pos_quotation, which every POS invoice created
	from a quotation carries. Returns are submitted invoices with negative stock
	quantity, so summing them naturally releases the returned quantity again.
	"""
	rows = frappe.db.sql(
		"""
		SELECT sii.item_code, SUM(sii.stock_qty) AS stock_qty
		FROM `tabSales Invoice Item` sii
		INNER JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1 AND si.custom_pos_quotation = %s
		GROUP BY sii.item_code
		""",
		(quotation,),
		as_dict=True,
	)
	return {row.item_code: flt(row.stock_qty) for row in rows}
