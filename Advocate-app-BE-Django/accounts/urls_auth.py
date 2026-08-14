from django.urls import path
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Password-reset OTP flow is deferred (needs SMTP). Endpoints respond safely so the
# frontend's forgot-password page doesn't error; wiring real OTP is a later phase.


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def forgot_password(request):
    return Response({'message': 'If an account exists, an OTP has been sent.'})


urlpatterns = [
    path('forgot-password', forgot_password),
]
