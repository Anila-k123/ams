from rest_framework import serializers
from core.models import Client

from .handlers import handler_map
from .profile import FIELDS as PROFILE_FIELDS, profile_map


class _ClientListSerializer(serializers.ListSerializer):
    """Looks up every row's handler and profile in one go, not once per client."""

    def to_representation(self, data):
        items = list(data.all() if hasattr(data, 'all') else data)
        ids = [c.id for c in items]
        self.child.context['handlers'] = handler_map(ids)
        self.child.context['profiles'] = profile_map(ids)
        return super().to_representation(items)


class ClientSerializer(serializers.ModelSerializer):
    """Mirrors Spring ClientResponseDTO, plus the handling advocate."""
    handlingAdvocate = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = ['id', 'name', 'email', 'phone', 'address', 'deleted', 'handlingAdvocate']
        list_serializer_class = _ClientListSerializer

    def to_representation(self, obj):
        data = super().to_representation(obj)
        profiles = self.context.get('profiles')
        if profiles is None:
            profiles = profile_map([obj.id])
        # Blank rather than missing for clients saved before profiles existed,
        # so the edit form always gets every field.
        blank = {k: '' for k in PROFILE_FIELDS}
        blank['billingCurrency'] = 'INR'
        data.update({**blank, **profiles.get(obj.id, {})})
        return data

    def get_handlingAdvocate(self, obj):
        handlers = self.context.get('handlers')
        if handlers is None:
            handlers = handler_map([obj.id])
        return handlers.get(obj.id)


class ClientRequestSerializer(serializers.Serializer):
    name = serializers.CharField()
    email = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    phone = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    address = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    # The advocate who will take the matter. Optional; null on an edit clears it.
    handlingAdvocateId = serializers.IntegerField(required=False, allow_null=True)
