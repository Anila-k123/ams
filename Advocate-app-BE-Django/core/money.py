"""Money for the law firm's own billing of its clients (invoices, payments,
receipts). Not AMS's subscription billing of firms - that is a separate,
future concern (Phase 8) and must not reuse these rules blindly.

The Spring-era columns (`invoices.amount`, `client_payments.amount`) are
double precision and stay that way (changing a legacy column type is not an
additive migration). So every amount is parsed, checked and rounded here as a
Decimal to whole paise, and only the final, already-rounded value is stored.
Arithmetic on amounts goes through Decimal too, never float sums.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

PAISA = Decimal('0.01')
ZERO = Decimal('0.00')
# One invoice or payment above this is a typo, not a fee (Rs. 100 crore).
MAX_AMOUNT = Decimal('1000000000.00')
# A firm bills in its own currency (FirmSettings.currency). Only INR is
# supported today: GST, words-in-rupees and the receipts assume it.
SUPPORTED_CURRENCIES = {'INR'}


class MoneyError(ValueError):
    pass


def to_decimal(value) -> Decimal:
    """Any stored or typed amount -> Decimal rounded to paise. Floats go through
    repr so 0.1 stays 0.10, not 0.1000000000000000055."""
    if value is None or value == '':
        return ZERO
    if isinstance(value, Decimal):
        d = value
    else:
        try:
            d = Decimal(repr(value) if isinstance(value, float) else str(value).strip().replace(',', ''))
        except (InvalidOperation, ValueError):
            raise MoneyError('Enter the amount as a number.')
    if not d.is_finite():
        raise MoneyError('Enter the amount as a number.')
    return d.quantize(PAISA, rounding=ROUND_HALF_UP)


def parse_amount(value, label='Amount', allow_zero=False) -> Decimal:
    """A typed amount: a number, at most two decimals, above zero, sane size."""
    if value is None or str(value).strip() == '':
        raise MoneyError(f'Enter the {label.lower()}.')
    raw = str(value).strip().replace(',', '')
    try:
        d = Decimal(raw)
    except (InvalidOperation, ValueError):
        raise MoneyError(f'Enter the {label.lower()} as a number.')
    if not d.is_finite():
        raise MoneyError(f'Enter the {label.lower()} as a number.')
    if d != d.quantize(PAISA):
        raise MoneyError(f'{label} can have at most two decimal places.')
    if d < 0 or (d == 0 and not allow_zero):
        raise MoneyError(f'{label} must be more than zero.')
    if d > MAX_AMOUNT:
        raise MoneyError(f'{label} is too large.')
    return d.quantize(PAISA)


def check_currency(value, firm_currency='INR'):
    """A currency sent with an amount must be the firm's (and supported)."""
    cur = (value or firm_currency or 'INR').strip().upper()
    if cur not in SUPPORTED_CURRENCIES:
        raise MoneyError(f'{cur} is not supported; amounts are in INR.')
    if firm_currency and cur != firm_currency.strip().upper():
        raise MoneyError(f'This firm bills in {firm_currency}.')
    return cur


def total(values) -> Decimal:
    return sum((to_decimal(v) for v in values), ZERO)


def stored(d: Decimal) -> float:
    """What goes into a legacy double-precision column: the rounded value."""
    return float(to_decimal(d))
