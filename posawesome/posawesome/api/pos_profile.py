import frappe

@frappe.whitelist()
def get_posa_invoice_naming_series():
	series = frappe.get_meta("Sales Invoice").get_field("naming_series").options
	frappe.db.set_value(
		"Custom Field",
		"POS Profile-posa_invoice_naming_series",
		"options",
		series
	)

	frappe.clear_cache()
	return {"options": series}