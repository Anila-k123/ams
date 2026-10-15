from django.urls import path

from . import views

urlpatterns = [
    path('platform/plans', views.PlansView.as_view()),
    path('platform/plans/<str:code>', views.PlanView.as_view()),
    path('platform/subscription-policy', views.SubscriptionPolicyView.as_view()),
    path('platform/firms/<uuid:public_id>/subscription', views.FirmSubscriptionView.as_view()),
    path('firm/subscription', views.MySubscriptionView.as_view()),
]
