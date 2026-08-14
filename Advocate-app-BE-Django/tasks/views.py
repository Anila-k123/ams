from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Task
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import TaskSerializer


def _base(request):
    return Task.objects.filter(advocate_id=request.user.id)


class TaskListView(APIView):
    permission_classes = [RequirePermission('TASK_VIEW')]

    def get(self, request):
        qs = _base(request)
        kw = request.query_params.get('keyword')
        if kw:
            qs = qs.filter(title__icontains=kw)
        qs = qs.order_by('completed', 'deadline', 'id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(TaskSerializer(page, many=True).data)


class MyTasksView(APIView):
    permission_classes = [RequirePermission('TASK_VIEW')]

    def get(self, request):
        qs = _base(request).order_by('completed', 'deadline', 'id')
        return Response(TaskSerializer(qs, many=True).data)


class CreateTaskView(APIView):
    permission_classes = [RequirePermission('TASK_CREATE')]

    def post(self, request):
        data = request.data
        if not data.get('title'):
            return Response({'error': 'title is required'}, status=status.HTTP_400_BAD_REQUEST)
        task = Task.objects.create(
            title=data['title'],
            priority=data.get('priority') or 'MEDIUM',
            deadline=data.get('deadline') or None,
            completed=False,
            advocate_id=request.user.id,
        )
        return Response(TaskSerializer(task).data, status=status.HTTP_201_CREATED)


class ToggleTaskView(APIView):
    permission_classes = [RequirePermission('TASK_EDIT')]

    def put(self, request, pk):
        task = _base(request).filter(id=pk).first()
        if task is None:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
        task.completed = not task.completed
        task.save(update_fields=['completed'])
        return Response(TaskSerializer(task).data)


class DeleteTaskView(APIView):
    permission_classes = [RequirePermission('TASK_DELETE')]

    def delete(self, request, pk):
        task = _base(request).filter(id=pk).first()
        if task is None:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)
        task.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
