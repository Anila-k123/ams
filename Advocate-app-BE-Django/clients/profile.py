"""The client form's extra fields (ClientProfile) and the one-line address
built from them for `clients.address`."""

from .models import ClientProfile

# API (camelCase, as the form sends them) -> ClientProfile field.
FIELDS = {
    'description': 'description', 'website': 'website',
    'billingCurrency': 'billing_currency', 'gstin': 'gstin',
    'building': 'building', 'street': 'street', 'city': 'city',
    'district': 'district', 'state': 'state', 'pincode': 'pincode',
    'country': 'country',
}
ADDRESS_PARTS = ('building', 'street', 'city', 'district', 'state', 'pincode', 'country')
# clients.address is varchar(255) in the Spring schema.
_ADDRESS_MAX = 255


def compose_address(parts):
    """'No. 3, Gandhi Street, Chennai, Tamil Nadu - 600045'-style one line.
    The pincode rides on the part before it, the way Indian addresses are written."""
    out = []
    for key in ADDRESS_PARTS:
        v = (parts.get(key) or '').strip()
        if not v:
            continue
        if key == 'pincode' and out:
            out[-1] = '{} - {}'.format(out[-1], v)
        else:
            out.append(v)
    return ', '.join(out)[:_ADDRESS_MAX]


def sent_fields(data):
    """The profile fields this request actually carried, cleaned. An older
    caller that sends none of them gets {} and nothing is touched."""
    return {model_key: str(data.get(api_key) or '').strip()
            for api_key, model_key in FIELDS.items() if api_key in data}


def save(client, fields):
    """Store the profile and refresh clients.address from its parts.

    Returns the new one-line address, or None to leave clients.address as it
    is: an old client edited in the form has no parts yet, and wiping the
    address they do have would lose it."""
    if not fields:
        return None
    ClientProfile.objects.update_or_create(client_id=client.id, defaults=fields)
    profile = ClientProfile.objects.get(client_id=client.id)
    parts = {k: getattr(profile, k) for k in ADDRESS_PARTS}
    # A country alone isn't an address: the form defaults it to India, and
    # "India" must not replace a saved address or become a new client's address.
    if not any((parts.get(k) or '').strip() for k in ADDRESS_PARTS if k != 'country'):
        return None
    line = compose_address(parts)
    return line or None


def profile_map(client_ids):
    """{client_id: {camelCase field: value}} for many clients in one query."""
    out = {}
    for p in ClientProfile.objects.filter(client_id__in=list(client_ids)):
        out[p.client_id] = {api: getattr(p, model) for api, model in FIELDS.items()}
    return out
