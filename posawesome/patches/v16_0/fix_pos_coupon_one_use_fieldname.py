"""Rename POS Coupon's `one_use` field, which was never spelled with an underscore.

The field shipped as `one` + U+0640 (ARABIC TATWEEL) + `use` — a character that looks
exactly like an underscore in most editors and is not one. `check_coupon_code` read
`coupon.one_use`, so every coupon validation raised AttributeError and no coupon
could be redeemed at all.

The doctype now declares `one_use`, which means a sync adds that column and leaves
the old one beside it holding the data. This copies it across and drops the original.
"""

import frappe

OLD = "oneـuse"
NEW = "one_use"
TABLE = "tabPOS Coupon"


def execute():
	columns = {row.Field for row in frappe.db.sql(f"SHOW COLUMNS FROM `{TABLE}`", as_dict=True)}
	if OLD not in columns:
		return

	if NEW in columns:
		# Carry over anything the old column was holding, without clobbering a value
		# somebody has already set on the new one.
		frappe.db.sql(
			f"""
			UPDATE `{TABLE}`
			SET `{NEW}` = `{OLD}`
			WHERE IFNULL(`{OLD}`, 0) != 0 AND IFNULL(`{NEW}`, 0) = 0
			"""
		)
	else:
		frappe.db.sql_ddl(f"ALTER TABLE `{TABLE}` CHANGE `{OLD}` `{NEW}` int(1) NOT NULL DEFAULT 0")
		frappe.clear_cache(doctype="POS Coupon")
		return

	frappe.db.sql_ddl(f"ALTER TABLE `{TABLE}` DROP COLUMN `{OLD}`")
	frappe.clear_cache(doctype="POS Coupon")
