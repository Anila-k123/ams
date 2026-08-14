from rest_framework import serializers
from core.models import Task


class TaskSerializer(serializers.ModelSerializer):
    """Mirrors Spring TaskResponseDTO (description is present but never populated)."""
    description = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = ['id', 'title', 'description', 'deadline', 'priority', 'completed']

    def get_description(self, obj):
        return None
