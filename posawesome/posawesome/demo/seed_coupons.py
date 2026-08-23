"""Seed test coupons and offers for a development site.

Not called by install or migrate — run it by hand when you want something to try the
coupon panel against:

    bench --site your-site.local execute posawesome.posawesome.demo.seed_coupons.main

Safe to re-run: it replaces what it made last time. It prints a table proving each
code resolves to the offer that unlocks it, because a coupon that validates and then
discounts nothing is the failure mode worth checking for.
"""

import traceback

import frappe
from frappe.utils import add_days, today

OFFERS = [
	# title, offer, apply_on, discount_type, field, value, min_amt, description
	("Test 10 Percent Off", "Grand Total", "Transaction", "Discount Percentage",
	 "discount_percentage", 10, 0, "10% off the whole sale."),
	("Test 50 Off Over 500", "Grand Total", "Transaction", "Discount Amount",
	 "discount_amount", 50, 500, "50 off any sale over 500."),
]

COUPONS = [
	# code, coupon_name, offer title, max_use, one_use
	("SAVE10", "Test Ten Percent", "Test 10 Percent Off", 500, 0),
	("TAKE50", "Test Fifty Off", "Test 50 Off Over 500", 500, 0),
	("ONCE10", "Test Once Per Customer", "Test 10 Percent Off", 500, 1),
]


def main():
	frappe.set_user("Administrator")
	try:
		run()
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		traceback.print_exc()


def run():
	profile = frappe.db.get_value("POS Profile", {"disabled": 0}, ["name", "company"], as_dict=True)
	company = profile.company if profile else frappe.db.get_value("Company", {}, "name")
	print(f"POS Profile : {profile.name if profile else '-'}")
	print(f"Company     : {company}\n")

	for title, offer, apply_on, dtype, field, value, min_amt, description in OFFERS:
		if frappe.db.exists("POS Offer", title):
			frappe.delete_doc("POS Offer", title, force=True, ignore_permissions=True)
		doc = frappe.new_doc("POS Offer")
		doc.title = title
		doc.company = company
		doc.apply_on = apply_on
		doc.offer = offer
		doc.discount_type = dtype
		setattr(doc, field, value)
		if min_amt:
			doc.min_amt = min_amt
		doc.coupon_based = 1
		doc.auto = 0
		doc.valid_from = today()
		doc.valid_upto = add_days(today(), 365)
		doc.description = description
		doc.insert()

	rows = []
	for code, name, offer_title, max_use, one_use in COUPONS:
		if frappe.db.exists("POS Coupon", name):
			frappe.delete_doc("POS Coupon", name, force=True, ignore_permissions=True)
		doc = frappe.new_doc("POS Coupon")
		doc.coupon_name = name
		doc.coupon_type = "Promotional"
		doc.company = company
		doc.pos_offer = offer_title
		doc.coupon_code = code
		doc.valid_from = today()
		doc.valid_upto = add_days(today(), 365)
		doc.maximum_use = max_use
		doc.one_use = one_use
		doc.description = offer_title
		doc.insert()
		rows.append((code, offer_title, max_use, one_use))

	# ---- prove each one resolves to its offer, which is what unlocks it -----
	from posawesome.posawesome.api.offers import get_pos_coupon

	customer = frappe.get_all("Customer", pluck="name", limit=1)[0]
	print(f"{'CODE':<9} {'RESULT':<8} {'UNLOCKS':<26} {'MAX':>5}  ONE-USE")
	print("-" * 66)
	for code, offer_title, max_use, one_use in rows:
		res = get_pos_coupon(code, customer, company)
		unlocked = res["coupon"].pos_offer if res.get("coupon") else "-"
		print(f"{code:<9} {res.get('msg'):<8} {unlocked:<26} {max_use:>5}  {'yes' if one_use else 'no'}")

	print("\nlowercase 'save10' :", get_pos_coupon("save10", customer, company).get("msg"))
	print("unknown  'NOPE99'  :", get_pos_coupon("NOPE99", customer, company).get("msg"))
	print(f"\nvalid until        : {add_days(today(), 365)}")
