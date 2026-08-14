from rest_framework import serializers
from core.models import Document


class DocumentSerializer(serializers.ModelSerializer):
    """Mirrors Spring DocumentResponseDTO (nested caseEntity + client)."""
    documentName = serializers.CharField(source='document_name')
    originalName = serializers.CharField(source='original_name')
    storedName = serializers.CharField(source='stored_name')
    filePath = serializers.CharField(source='file_path')
    fileSize = serializers.IntegerField(source='file_size')
    fileType = serializers.CharField(source='file_type')
    downloadCount = serializers.IntegerField(source='download_count')
    uploadDate = serializers.DateTimeField(source='upload_date')
    updatedAt = serializers.DateTimeField(source='updated_at')
    caseEntity = serializers.SerializerMethodField()
    client = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            'id', 'documentName', 'originalName', 'storedName', 'filePath', 'fileSize',
            'fileType', 'category', 'description', 'version', 'downloadCount', 'status',
            'uploadDate', 'updatedAt', 'caseEntity', 'client',
        ]

    def get_caseEntity(self, obj):
        if not obj.case_id:
            return None
        return {'id': obj.case.id, 'caseNumber': obj.case.case_number, 'caseTitle': obj.case.case_title}

    def get_client(self, obj):
        if not obj.client_id:
            return None
        return {'id': obj.client.id, 'name': obj.client.name}
