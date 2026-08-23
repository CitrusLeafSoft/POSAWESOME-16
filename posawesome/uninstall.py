"""Remove POS Awesome's customisations when the app is uninstalled."""

import frappe

from posawesome.install import V16_CUSTOM_FIELDS


def after_uninstall():
	_delete_fixture_customisations()
	_delete_v16_custom_fields()
	frappe.db.commit()


def _delete_fixture_customisations():
	for fixture in frappe.get_hooks("fixtures", app_name="posawesome"):
		if not isinstance(fixture, dict):
			continue
		doctype = fixture.get("doctype")
		if doctype not in ("Custom Field", "Property Setter"):
			continue
		for condition in fixture.get("filters") or []:
			frappe.db.delete(doctype, condition)


def _delete_v16_custom_fields():
	for doctype, fields in V16_CUSTOM_FIELDS.items():
		for field in fields:
			frappe.db.delete("Custom Field", {"dt": doctype, "fieldname": field["fieldname"]})
