"""POS Awesome — a modern point of sale for ERPNext."""
import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
__version__ = "16.0.0"



def validate_pos_paid_amount(self):
    if len(self.payments) == 0 and self.is_pos and self.grand_total > 0:
        pass


SalesInvoice.validate_pos_paid_amount = validate_pos_paid_amount