import os
from rest_framework import serializers
from core.models import Advocate


def _branding_url(path, context):
    """Turn a stored branding path into a loadable URL (/api/profile/files/branding/<name>)."""
    if not path:
        return None
    name = os.path.basename(path.replace('\\', '/'))
    rel = '/api/profile/files/branding/' + name
    request = context.get('request') if context else None
    return request.build_absolute_uri(rel) if request else rel


class AdvocateProfileSerializer(serializers.ModelSerializer):
    """Mirrors Spring's AdvocateProfileDTO (the /api/advocates/profile shape)."""
    fullName = serializers.CharField(source='full_name', required=False, allow_blank=True)
    barCouncilId = serializers.CharField(source='bar_council_id', required=False, allow_blank=True)
    whatsappEnabled = serializers.BooleanField(source='whatsapp_enabled', required=False)
    emailNotificationsEnabled = serializers.BooleanField(source='email_notifications_enabled', required=False)
    browserNotificationsEnabled = serializers.BooleanField(source='browser_notifications_enabled', required=False)

    class Meta:
        model = Advocate
        fields = [
            'id', 'fullName', 'email', 'phone', 'barCouncilId', 'specialization',
            'experience', 'address', 'role', 'theme',
            'whatsappEnabled', 'emailNotificationsEnabled', 'browserNotificationsEnabled',
        ]


class FullProfileSerializer(serializers.ModelSerializer):
    """Richer profile used by the Profile page (/api/profile)."""
    fullName = serializers.CharField(source='full_name', required=False, allow_blank=True)
    barCouncilId = serializers.CharField(source='bar_council_id', required=False, allow_blank=True)
    dateOfBirth = serializers.DateField(source='date_of_birth', required=False, allow_null=True)
    enrollmentDate = serializers.DateField(source='enrollment_date', required=False, allow_null=True)
    officeName = serializers.CharField(source='office_name', required=False, allow_blank=True, allow_null=True)
    officeAddress = serializers.CharField(source='office_address', required=False, allow_blank=True, allow_null=True)
    pinCode = serializers.CharField(source='pin_code', required=False, allow_blank=True, allow_null=True)
    officePhone = serializers.CharField(source='office_phone', required=False, allow_blank=True, allow_null=True)
    officeEmail = serializers.CharField(source='office_email', required=False, allow_blank=True, allow_null=True)
    gstNumber = serializers.CharField(source='gst_number', required=False, allow_blank=True, allow_null=True)
    panNumber = serializers.CharField(source='pan_number', required=False, allow_blank=True, allow_null=True)
    primaryBrandColor = serializers.CharField(source='primary_brand_color', required=False, allow_blank=True, allow_null=True)
    secondaryBrandColor = serializers.CharField(source='secondary_brand_color', required=False, allow_blank=True, allow_null=True)
    timeZone = serializers.CharField(source='time_zone', required=False, allow_blank=True, allow_null=True)
    dateFormat = serializers.CharField(source='date_format', required=False, allow_blank=True, allow_null=True)
    autoLogoutDuration = serializers.IntegerField(source='auto_logout_duration', required=False, allow_null=True)
    defaultDashboardFilter = serializers.CharField(source='default_dashboard_filter', required=False, allow_blank=True, allow_null=True)
    whatsappEnabled = serializers.BooleanField(source='whatsapp_enabled', required=False)
    emailNotificationsEnabled = serializers.BooleanField(source='email_notifications_enabled', required=False)
    browserNotificationsEnabled = serializers.BooleanField(source='browser_notifications_enabled', required=False)
    # Branding images exposed as absolute *Url built from the stored path.
    profilePhotoUrl = serializers.SerializerMethodField()
    officeLogoUrl = serializers.SerializerMethodField()
    signatureUrl = serializers.SerializerMethodField()
    officeSealUrl = serializers.SerializerMethodField()

    class Meta:
        model = Advocate
        fields = [
            'id', 'fullName', 'email', 'phone', 'barCouncilId', 'specialization',
            'experience', 'address', 'dateOfBirth', 'gender', 'enrollmentDate', 'bio',
            'officeName', 'officeAddress', 'city', 'state', 'country', 'pinCode',
            'officePhone', 'officeEmail', 'website', 'gstNumber', 'panNumber',
            'profilePhotoUrl', 'officeLogoUrl', 'signatureUrl', 'officeSealUrl',
            'primaryBrandColor', 'secondaryBrandColor', 'theme', 'language', 'timeZone',
            'currency', 'dateFormat', 'autoLogoutDuration', 'defaultDashboardFilter',
            'role', 'whatsappEnabled', 'emailNotificationsEnabled', 'browserNotificationsEnabled',
        ]

    def get_profilePhotoUrl(self, obj):
        return _branding_url(obj.profile_photo_path, self.context)

    def get_officeLogoUrl(self, obj):
        return _branding_url(obj.office_logo_path, self.context)

    def get_signatureUrl(self, obj):
        return _branding_url(obj.signature_path, self.context)

    def get_officeSealUrl(self, obj):
        return _branding_url(obj.office_seal_path, self.context)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()


class SignupSerializer(serializers.Serializer):
    fullName = serializers.CharField()
    email = serializers.EmailField()
    password = serializers.CharField()
    phone = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    barCouncilId = serializers.CharField()
    specialization = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    experience = serializers.IntegerField(required=False, default=0)
    address = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    role = serializers.CharField(required=False, allow_blank=True, allow_null=True)
