"""Pagination shaped exactly like the Spring backend's Map<String,Object> so the
React frontend (which reads content / totalElements / totalPages) works unchanged.
Query params are 0-indexed `page` and `size`.
"""

from django.core.paginator import Paginator
from rest_framework.pagination import BasePagination
from rest_framework.response import Response


class SpringStylePagination(BasePagination):
    page_size = 20
    max_page_size = 500

    def paginate_queryset(self, queryset, request, view=None):
        self.request = request
        try:
            page_size = int(request.query_params.get('size', self.page_size))
        except (TypeError, ValueError):
            page_size = self.page_size
        page_size = max(1, min(page_size, self.max_page_size))
        try:
            zero_based = max(int(request.query_params.get('page', 0)), 0)
        except (TypeError, ValueError):
            zero_based = 0

        paginator = Paginator(queryset, page_size)
        page_number = zero_based + 1
        if page_number > paginator.num_pages:
            page_number = paginator.num_pages
        self.page = paginator.get_page(page_number)
        self._page_size = page_size
        return list(self.page)

    def get_paginated_response(self, data):
        page = self.page
        return Response({
            'content': data,
            'page': page.number - 1,               # 0-indexed, Spring-style
            'size': self._page_size,
            'totalElements': page.paginator.count,
            'totalPages': page.paginator.num_pages,
            'hasNext': page.has_next(),
            'hasPrevious': page.has_previous(),
            'last': not page.has_next(),
            'first': not page.has_previous(),
        })
