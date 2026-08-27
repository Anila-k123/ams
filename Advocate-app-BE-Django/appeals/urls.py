from django.urls import path
from . import views

urlpatterns = [
    # Candidate appeals detected by the nightly scan_appeals sweep.
    # There is no manual-entry route: the old form recorded a
    # court/case-number/judgment-date and did nothing with them.
    path('appeal-detections', views.AppealDetectionListView.as_view()),
    path('appeal-detections/<int:pk>', views.AppealDetectionStatusView.as_view()),
]
