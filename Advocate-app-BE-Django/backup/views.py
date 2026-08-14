import os
import json
from django.conf import settings
from django.db import connection
from django.http import FileResponse, Http404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from . import service


class _CreateBackup(APIView):
    backup_type = 'FULL'

    def post(self, request):
        return Response(service.create_backup(request.user, self.backup_type),
                        status=status.HTTP_201_CREATED)


class QuickBackup(_CreateBackup):
    backup_type = 'QUICK'


class FullBackup(_CreateBackup):
    backup_type = 'FULL'


class DatabaseBackup(_CreateBackup):
    backup_type = 'DATABASE'


class DocumentsBackup(_CreateBackup):
    backup_type = 'DOCUMENTS'


class ReportsBackup(_CreateBackup):
    backup_type = 'REPORTS'


class SettingsBackup(_CreateBackup):
    backup_type = 'SETTINGS'


class ValidateView(APIView):
    def post(self, request):
        f = request.FILES.get('file')
        if f is None:
            return Response({'valid': False, 'error': 'file is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(service.validate_zip(f.read()))


class RestoreView(APIView):
    def post(self, request):
        f = request.FILES.get('file')
        if f is None:
            return Response({'status': 'FAILED', 'message': 'file is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        rtype = request.query_params.get('type') or request.data.get('type') or 'FULL'
        return Response(service.restore_backup(request.user, f.read(), rtype.upper()))


class HistoryView(APIView):
    def get(self, request):
        with connection.cursor() as cur:
            cur.execute(
                'SELECT id, file_name, file_size, backup_type, status, checksum, '
                'duration_seconds, metadata_json, created_at FROM backup_history '
                'WHERE advocate_id = %s ORDER BY created_at DESC, id DESC', [request.user.id])
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return Response([{
            'id': r['id'], 'fileName': r['file_name'], 'fileSize': r['file_size'],
            'backupType': r['backup_type'], 'status': r['status'], 'checksum': r['checksum'],
            'durationSeconds': r['duration_seconds'], 'metadataJson': r['metadata_json'],
            'createdAt': r['created_at'].isoformat() if r['created_at'] else None,
        } for r in rows])


class StatsView(APIView):
    def get(self, request):
        with connection.cursor() as cur:
            cur.execute('SELECT count(*), COALESCE(sum(file_size),0) FROM backup_history '
                        'WHERE advocate_id = %s', [request.user.id])
            total, total_size = cur.fetchone()
            cur.execute('SELECT created_at, backup_type, status FROM backup_history '
                        'WHERE advocate_id = %s ORDER BY created_at DESC LIMIT 1', [request.user.id])
            latest = cur.fetchone()
        return Response({
            'totalBackups': total, 'totalSize': int(total_size or 0),
            'latestBackup': latest[0].isoformat() if latest else None,
            'latestBackupType': latest[1] if latest else None,
            'latestBackupStatus': latest[2] if latest else None,
        })


class DownloadView(APIView):
    def get(self, request, pk):
        with connection.cursor() as cur:
            cur.execute('SELECT file_name FROM backup_history WHERE id = %s AND advocate_id = %s',
                        [pk, request.user.id])
            row = cur.fetchone()
        if row is None:
            raise Http404('Backup not found')
        path = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'backups', row[0])
        if not os.path.exists(path):
            raise Http404('Backup file missing')
        resp = FileResponse(open(path, 'rb'), content_type='application/octet-stream')
        resp['Content-Disposition'] = f'attachment; filename="{row[0]}"'
        return resp


class DeleteView(APIView):
    def delete(self, request, pk):
        with connection.cursor() as cur:
            cur.execute('SELECT file_name FROM backup_history WHERE id = %s AND advocate_id = %s',
                        [pk, request.user.id])
            row = cur.fetchone()
            if row is None:
                return Response({'error': 'Backup not found'}, status=status.HTTP_404_NOT_FOUND)
            path = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'backups', row[0])
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass
            cur.execute('DELETE FROM backup_history WHERE id = %s AND advocate_id = %s',
                        [pk, request.user.id])
        return Response(status=status.HTTP_204_NO_CONTENT)
