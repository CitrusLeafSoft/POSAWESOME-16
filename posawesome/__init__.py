"""POS Awesome — a modern point of sale for ERPNext."""
import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
__version__ = "16.0.0"

def get_loyalty_point_entries_fifo(customer, loyalty_program, company, expiry_date=None):
    from frappe.utils import today

    if not expiry_date:
        expiry_date = today()

    return frappe.db.sql(
        """
        select
            name,
            loyalty_points,
            expiry_date,
            loyalty_program_tier,
            invoice_type,
            invoice
        from `tabLoyalty Point Entry`
        where customer=%s
            and loyalty_program=%s
            and expiry_date>=%s
            and loyalty_points>0
            and company=%s
        order by expiry_date, creation
        """,
        (customer, loyalty_program, expiry_date, company),
        as_dict=1,
    )


def _patch_loyalty_redemption_fifo():
    from erpnext.accounts.doctype.loyalty_point_entry import loyalty_point_entry

    if loyalty_point_entry.get_loyalty_point_entries is get_loyalty_point_entries_fifo:
        return
    
    loyalty_point_entry.get_loyalty_point_entries = get_loyalty_point_entries_fifo


_patch_loyalty_redemption_fifo()



def validate_pos_paid_amount(self):
    if len(self.payments) == 0 and self.is_pos and self.grand_total > 0:
        pass


SalesInvoice.validate_pos_paid_amount = validate_pos_paid_amount