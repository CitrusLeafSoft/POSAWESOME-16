import json

import frappe

SYNC_PROPS = ("value", "property_type", "default_value", "module")


def execute():
	rows = PROPERTY_SETTERS

	unique = {}
	for row in rows:
		unique[identity(row)] = row

	stats = {"created": 0, "updated": 0, "unchanged": 0, "skipped": 0, "failed": 0}
	touched = set()

	for row in unique.values():
		label = f"{row['doc_type']}-{row.get('field_name') or 'main'}-{row['property']}"

		if not frappe.db.exists("DocType", row["doc_type"]):
			stats["skipped"] += 1
			print(f"SKIPPED {label}: DocType '{row['doc_type']}' not found")
			continue

		if row.get("doctype_or_field") == "DocField" and not field_exists(row["doc_type"], row.get("field_name")):
			stats["skipped"] += 1
			print(f"SKIPPED {label}: field '{row.get('field_name')}' not found on {row['doc_type']}")
			continue

		module = row.get("module")
		if module and not frappe.db.exists("Module Def", module):
			module = None

		try:
			names = find_existing(row)
			if names:
				changed = update_existing(names[0], row, module)
				stats["updated" if changed else "unchanged"] += 1
				if changed:
					print(f"UPDATED {names[0]}")
				for dup in names[1:]:
					frappe.delete_doc("Property Setter", dup, ignore_permissions=True, force=True)
					print(f"REMOVED duplicate {dup}")
			else:
				create(row, module)
				stats["created"] += 1
				print(f"CREATED {label}")
			touched.add(row["doc_type"])
		except Exception:
			stats["failed"] += 1
			frappe.log_error(title=f"Property Setter sync failed: {label}")
			print(f"FAILED  {label} (see Error Log)")

	for dt in touched:
		frappe.clear_cache(doctype=dt)
	frappe.db.commit()

	print("Property setter sync:", stats)


def identity(row):
	return (
		row["doc_type"],
		row.get("doctype_or_field") or "DocField",
		row.get("field_name") or "",
		row["property"],
		row.get("row_name") or "",
	)


def find_existing(row):
	filters = {
		"doc_type": row["doc_type"],
		"doctype_or_field": row.get("doctype_or_field") or "DocField",
		"property": row["property"],
	}
	if row.get("field_name"):
		filters["field_name"] = row["field_name"]
	if row.get("row_name"):
		filters["row_name"] = row["row_name"]

	names = frappe.get_all("Property Setter", filters=filters, fields=["name", "field_name", "row_name"], order_by="creation asc")
	return [
		n.name for n in names
		if (n.field_name or "") == (row.get("field_name") or "")
		and (n.row_name or "") == (row.get("row_name") or "")
	]


def create(row, module):
	doc = frappe.get_doc({
		"doctype": "Property Setter",
		"doc_type": row["doc_type"],
		"doctype_or_field": row.get("doctype_or_field") or "DocField",
		"field_name": row.get("field_name"),
		"row_name": row.get("row_name"),
		"property": row["property"],
		"property_type": row.get("property_type"),
		"value": row.get("value"),
		"default_value": row.get("default_value"),
		"module": module,
		"is_system_generated": row.get("is_system_generated") or 0,
	})
	doc.insert(ignore_permissions=True)


def update_existing(name, row, module):
	doc = frappe.get_doc("Property Setter", name)
	changes = {}
	for prop in SYNC_PROPS:
		new = module if prop == "module" else row.get(prop)
		if not same(prop, doc.get(prop), new, row["property"]):
			changes[prop] = new

	if not changes:
		return False

	doc.update(changes)
	doc.save(ignore_permissions=True)
	return True


def same(prop, old, new, ps_property):
	if prop == "value" and ps_property == "field_order":
		try:
			return json.loads(old or "[]") == json.loads(new or "[]")
		except ValueError:
			pass
	return (old or None) == (new or None) if not isinstance(old, (int, float)) else str(old) == str(new)


def field_exists(dt, fieldname):
	if not fieldname:
		return False
	return bool(
		frappe.db.exists("DocField", {"parent": dt, "fieldname": fieldname})
		or frappe.db.exists("Custom Field", {"dt": dt, "fieldname": fieldname})
	)


# Property Setter definitions (exported from the POSAwesome fixtures).
# Kept inline so the patch is self-contained and does not read an external JSON file.
PROPERTY_SETTERS = [
	{
		"default_value": None,
		"doc_type": "Branch",
		"doctype_or_field": "DocType",
		"field_name": None,
		"is_system_generated": 0,
		"module": "POSAwesome",
		"property": "field_order",
		"property_type": "Data",
		"row_name": None,
		"value": "[\"branch\", \"custom_pos_naming_series\"]",
	},
	{
		"default_value": "Draft",
		"doc_type": "Quotation",
		"doctype_or_field": "DocField",
		"field_name": "status",
		"is_system_generated": 0,
		"module": "POSAwesome",
		"property": "options",
		"property_type": "text",
		"row_name": None,
		"value": "Draft\nOpen\nReplied\nPartially Ordered\nOrdered\nPartially Invoiced\nInvoiced\nLost\nCancelled\nExpired",
	},
	{
		"default_value": None,
		"doc_type": "POS Profile",
		"doctype_or_field": "DocType",
		"field_name": None,
		"is_system_generated": 0,
		"module": "POSAwesome",
		"property": "field_order",
		"property_type": "Data",
		"row_name": None,
		"value": "[\"company\", \"customer\", \"country\", \"disabled\", \"column_break_9\", \"warehouse\", \"posa_invoice_naming_series\", \"company_address\", \"accounting_dimensions_section\", \"cost_center\", \"dimension_col_break\", \"branch\", \"project\", \"accounting_tab\", \"posa_pos_awesome_settings\", \"posa_cash_mode_of_payment\", \"posa_allow_delete\", \"posa_allow_user_to_edit_rate\", \"posa_allow_user_to_edit_additional_discount\", \"posa_use_percentage_discount\", \"posa_max_discount_allowed\", \"posa_scale_barcode_start\", \"posa_allow_change_posting_date\", \"posa_default_card_view\", \"posa_default_sales_order\", \"posa_allow_loyalty_redemption\", \"posa_col_1\", \"posa_allow_user_to_edit_item_discount\", \"posa_display_items_in_stock\", \"posa_allow_partial_payment\", \"posa_allow_credit_sale\", \"posa_allow_return\", \"posa_apply_customer_discount\", \"use_cashback\", \"use_customer_credit\", \"posa_hide_closing_shift\", \"posa_auto_set_batch\", \"posa_display_item_code\", \"posa_allow_zero_rated_items\", \"hide_expected_amount\", \"posa_column_break_112\", \"posa_allow_sales_order\", \"posa_show_template_items\", \"posa_hide_variants_items\", \"posa_fetch_coupon\", \"posa_allow_customer_purchase_order\", \"posa_allow_print_last_invoice\", \"posa_display_additional_notes\", \"posa_allow_write_off_change\", \"posa_new_line\", \"posa_input_qty\", \"posa_allow_print_draft_invoices\", \"posa_use_delivery_charges\", \"posa_auto_set_delivery_charges\", \"posa_allow_duplicate_customer_names\", \"pos_awesome_payments\", \"posa_use_pos_awesome_payments\", \"column_break_uolvm\", \"posa_allow_make_new_payments\", \"posa_allow_reconcile_payments\", \"posa_allow_mpesa_reconcile_payments\", \"posa_pos_awesome_advance_settings\", \"posa_allow_submissions_in_background_job\", \"posa_search_serial_no\", \"posa_search_batch_no\", \"posa_tax_inclusive\", \"column_break_dqsba\", \"posa_local_storage\", \"posa_use_server_cache\", \"posa_server_cache_duration\", \"column_break_anyol\", \"pose_use_limit_search\", \"posa_search_limit\", \"posa_offline_section\", \"posa_allow_offline_mode\", \"posa_offline_cache_ttl\", \"posa_offline_column_break\", \"posa_offline_max_queue\", \"posa_credit_section\", \"custom_allow_select_sales_order\", \"section_break_11\", \"payments\", \"set_grand_total_to_default_mop\", \"price_list_and_currency_section\", \"currency\", \"column_break_bptt\", \"selling_price_list\", \"write_off_section\", \"write_off_account\", \"column_break_ukpz\", \"write_off_cost_center\", \"column_break_pkca\", \"write_off_limit\", \"income_and_expense_account\", \"income_account\", \"column_break_byzk\", \"expense_account\", \"taxes_section\", \"taxes_and_charges\", \"column_break_cjpp\", \"tax_category\", \"section_break_19\", \"account_for_change_amount\", \"disable_rounded_total\", \"column_break_23\", \"apply_discount_on\", \"allow_partial_payment\", \"pos_configurations_tab\", \"section_break_14\", \"action_on_new_invoice\", \"validate_stock_on_save\", \"column_break_16\", \"update_stock\", \"ignore_pricing_rule\", \"print_receipt_on_order_complete\", \"pos_item_selector_section\", \"hide_images\", \"column_break_rpny\", \"hide_unavailable_items\", \"column_break_stcl\", \"auto_add_item_to_cart\", \"pos_item_details_section\", \"allow_rate_change\", \"column_break_hwfg\", \"allow_discount_change\", \"section_break_15\", \"applicable_for_users\", \"section_break_23\", \"item_groups\", \"column_break_25\", \"customer_groups\", \"more_info_tab\", \"section_break_16\", \"print_format\", \"letter_head\", \"column_break0\", \"tc_name\", \"select_print_heading\", \"utm_analytics_section\", \"utm_source\", \"column_break_tvls\", \"utm_campaign\", \"column_break_xygw\", \"utm_medium\"]",
	},
	{
		"default_value": None,
		"doc_type": "POS Profile",
		"doctype_or_field": "DocField",
		"field_name": "cost_center",
		"is_system_generated": 0,
		"module": "POSAwesome",
		"property": "reqd",
		"property_type": "Check",
		"row_name": None,
		"value": "1",
	},
	{
		"default_value": None,
		"doc_type": "POS Profile",
		"doctype_or_field": "DocField",
		"field_name": "branch",
		"is_system_generated": 0,
		"module": "POSAwesome",
		"property": "reqd",
		"property_type": "Check",
		"row_name": None,
		"value": "1",
	},
	{
		"default_value": None,
		"doc_type": "Customer",
		"doctype_or_field": "DocField",
		"field_name": "customer_name",
		"is_system_generated": 1,
		"module": "POSAwesome",
		"property": "in_list_view",
		"property_type": "Check",
		"row_name": None,
		"value": "1",
	},
	{
		"default_value": None,
		"doc_type": "Customer",
		"doctype_or_field": "DocField",
		"field_name": "customer_type",
		"is_system_generated": 1,
		"module": "POSAwesome",
		"property": "in_list_view",
		"property_type": "Check",
		"row_name": None,
		"value": "1",
	},
	{
		"default_value": None,
		"doc_type": "Customer",
		"doctype_or_field": "DocField",
		"field_name": "customer_group",
		"is_system_generated": 1,
		"module": "POSAwesome",
		"property": "in_list_view",
		"property_type": "Check",
		"row_name": None,
		"value": "1",
	},
	{
		"default_value": None,
		"doc_type": "Customer",
		"doctype_or_field": "DocField",
		"field_name": "territory",
		"is_system_generated": 1,
		"module": "POSAwesome",
		"property": "in_list_view",
		"property_type": "Check",
		"row_name": None,
		"value": "1",
	},
	{
		"default_value": None,
		"doc_type": "Customer",
		"doctype_or_field": "DocField",
		"field_name": "default_currency",
		"is_system_generated": 1,
		"module": "POSAwesome",
		"property": "in_list_view",
		"property_type": "Check",
		"row_name": None,
		"value": "1",
	},
]
