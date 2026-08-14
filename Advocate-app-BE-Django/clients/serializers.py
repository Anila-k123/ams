from rest_framework import serializers
from core.models import Client


class ClientSerializer(serializers.ModelSerializer):
    """Mirrors Spring ClientResponseDTO."""
    class Meta:
        model = Client
        fields = ['id', 'name', 'email', 'phone', 'address', 'deleted']


class ClientRequestSerializer(serializers.Serializer):
    name = serializers.CharField()
    email = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    phone = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    address = serializers.CharField(required=False, allow_blank=True, allow_null=True)
