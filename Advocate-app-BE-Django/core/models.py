"""Unmanaged models mapping onto the existing advocate_db tables (created by the
Spring/Hibernate backend). managed=False => Django never migrates or drops them.
Column names follow Hibernate's snake_case; camelCase JSON is produced in the
serializers, not here.
"""

from django.db import models


class Advocate(models.Model):
    id = models.BigAutoField(primary_key=True)
    full_name = models.CharField(max_length=255)
    email = models.CharField(max_length=255, unique=True)
    password = models.CharField(max_length=255)
    bar_council_id = models.CharField(max_length=255, unique=True)
    phone = models.CharField(max_length=255, null=True, blank=True)
    specialization = models.CharField(max_length=255, null=True, blank=True)
    experience = models.IntegerField(default=0)
    address = models.CharField(max_length=255, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=255, null=True, blank=True)
    enrollment_date = models.DateField(null=True, blank=True)
    bio = models.CharField(max_length=255, null=True, blank=True)
    office_name = models.CharField(max_length=255, null=True, blank=True)
    office_address = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=255, null=True, blank=True)
    state = models.CharField(max_length=255, null=True, blank=True)
    country = models.CharField(max_length=255, null=True, blank=True)
    pin_code = models.CharField(max_length=255, null=True, blank=True)
    office_phone = models.CharField(max_length=255, null=True, blank=True)
    office_email = models.CharField(max_length=255, null=True, blank=True)
    website = models.CharField(max_length=255, null=True, blank=True)
    gst_number = models.CharField(max_length=255, null=True, blank=True)
    pan_number = models.CharField(max_length=255, null=True, blank=True)
    profile_photo_path = models.CharField(max_length=255, null=True, blank=True)
    office_logo_path = models.CharField(max_length=255, null=True, blank=True)
    signature_path = models.CharField(max_length=255, null=True, blank=True)
    office_seal_path = models.CharField(max_length=255, null=True, blank=True)
    primary_brand_color = models.CharField(max_length=255, null=True, blank=True)
    secondary_brand_color = models.CharField(max_length=255, null=True, blank=True)
    language = models.CharField(max_length=255, null=True, blank=True)
    time_zone = models.CharField(max_length=255, null=True, blank=True)
    currency = models.CharField(max_length=255, null=True, blank=True)
    date_format = models.CharField(max_length=255, null=True, blank=True)
    auto_logout_duration = models.IntegerField(null=True, blank=True)
    default_dashboard_filter = models.CharField(max_length=255, null=True, blank=True)
    role = models.CharField(max_length=255, default='ADVOCATE')
    theme = models.CharField(max_length=255, default='light')
    whatsapp_enabled = models.BooleanField(default=False)
    email_notifications_enabled = models.BooleanField(default=False)
    browser_notifications_enabled = models.BooleanField(default=True)
    # Practice membership: NULL means this advocate owns a practice (or works
    # alone); a value means they are a member of that advocate's practice.
    # Added by `manage.py enable_shared_practice` - the table is Spring-owned,
    # so there is no migration for it. See core/practice.py.
    parent_advocate_id = models.BigIntegerField(null=True, blank=True)
    # The date this advocate left the practice, or NULL while they are active.
    #
    # Leaving does NOT clear parent_advocate_id. Visibility is derived from who
    # is in the practice, so unlinking a departing member made every row they
    # created unreachable - the chambers lost its own case files because a
    # junior moved on. They stay a (former) member for data purposes and lose
    # access instead. Added by `manage.py enable_shared_practice`.
    left_on = models.DateField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'advocate'

    # --- DRF/auth compatibility: request.user is an Advocate instance ---
    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def permission_codes(self):
        """Return the set of permission name strings for this advocate,
        resolved through advocate_roles -> role_permissions -> permissions."""
        role_ids = AdvocateRole.objects.filter(
            advocate_id=self.id).values_list('role_id', flat=True)
        perm_ids = RolePermission.objects.filter(
            role_id__in=list(role_ids)).values_list('permission_id', flat=True)
        return set(Permission.objects.filter(
            id__in=list(perm_ids)).values_list('name', flat=True))

    def role_names(self):
        role_ids = AdvocateRole.objects.filter(
            advocate_id=self.id).values_list('role_id', flat=True)
        return list(Role.objects.filter(
            id__in=list(role_ids)).values_list('name', flat=True))


class Client(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255, null=True, blank=True)
    email = models.CharField(max_length=255, null=True, blank=True)
    phone = models.CharField(max_length=255, null=True, blank=True)
    address = models.CharField(max_length=255, null=True, blank=True)
    deleted = models.BooleanField(default=False)
    created_at = models.DateField(null=True, blank=True)
    advocate = models.ForeignKey(Advocate, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='advocate_id')

    class Meta:
        managed = False
        db_table = 'clients'


class Case(models.Model):
    id = models.BigAutoField(primary_key=True)
    # Unique per ADVOCATE, not globally - see the constraint below and
    # `manage.py scope_case_numbers`. A court case number is unique within a
    # court, not nationally (123/2024 exists in hundreds of district courts),
    # and two advocates on opposite sides of one matter are both entitled to
    # track it.
    case_number = models.CharField(max_length=255)
    case_title = models.CharField(max_length=255, null=True, blank=True)
    case_type = models.CharField(max_length=255, null=True, blank=True)
    court_level = models.CharField(max_length=255, null=True, blank=True)
    status = models.CharField(max_length=255, null=True, blank=True)
    amount = models.FloatField(null=True, blank=True)
    description = models.CharField(max_length=255, null=True, blank=True)
    estimated_amount = models.FloatField(null=True, blank=True)
    total_client_agreed_amount = models.FloatField(null=True, blank=True)
    total_paid_by_client = models.FloatField(null=True, blank=True)
    total_expenses_so_far = models.FloatField(null=True, blank=True)
    balance_in_account = models.FloatField(null=True, blank=True)
    pending_from_client = models.FloatField(null=True, blank=True)
    deleted = models.BooleanField(default=False)
    created_at = models.DateField(null=True, blank=True)
    advocate = models.ForeignKey(Advocate, on_delete=models.DO_NOTHING, db_column='advocate_id')
    client = models.ForeignKey(Client, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='client_id')

    class Meta:
        managed = False
        db_table = 'cases'
        constraints = [
            # Mirrors the live constraint so the test database matches the real
            # one. Named to match what scope_case_numbers creates.
            models.UniqueConstraint(fields=['advocate', 'case_number'],
                                    name='cases_advocate_case_number_key'),
        ]


class CaseEvent(models.Model):
    id = models.BigAutoField(primary_key=True)
    title = models.CharField(max_length=255)
    event_type = models.CharField(max_length=255)
    description = models.CharField(max_length=255, null=True, blank=True)
    date = models.DateField()
    time = models.TimeField(null=True, blank=True)
    notified = models.BooleanField(default=False)
    case = models.ForeignKey(Case, on_delete=models.DO_NOTHING, db_column='case_id')
    advocate = models.ForeignKey(Advocate, on_delete=models.DO_NOTHING, db_column='advocate_id')

    class Meta:
        managed = False
        db_table = 'case_events'


class Document(models.Model):
    id = models.BigAutoField(primary_key=True)
    document_name = models.CharField(max_length=255)
    original_name = models.CharField(max_length=255)
    stored_name = models.CharField(max_length=255)
    file_path = models.CharField(max_length=255)
    file_size = models.BigIntegerField(null=True, blank=True)
    file_type = models.CharField(max_length=255, null=True, blank=True)
    category = models.CharField(max_length=255, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    version = models.IntegerField(default=1)
    download_count = models.IntegerField(default=0)
    status = models.CharField(max_length=255, null=True, blank=True)
    upload_date = models.DateTimeField()
    updated_at = models.DateTimeField(null=True, blank=True)
    advocate = models.ForeignKey(Advocate, on_delete=models.DO_NOTHING, db_column='advocate_id')
    case = models.ForeignKey(Case, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='case_id')
    client = models.ForeignKey(Client, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='client_id')

    class Meta:
        managed = False
        db_table = 'documents'


class Role(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255, unique=True)
    description = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'roles'


class Permission(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255, unique=True)
    description = models.CharField(max_length=255, null=True, blank=True)
    module = models.CharField(max_length=255)
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'permissions'


class AdvocateRole(models.Model):
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField()
    role_id = models.BigIntegerField()
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'advocate_roles'


class RolePermission(models.Model):
    id = models.BigAutoField(primary_key=True)
    role_id = models.BigIntegerField()
    permission_id = models.BigIntegerField()
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'role_permissions'


class Expense(models.Model):
    id = models.BigAutoField(primary_key=True)
    title = models.CharField(max_length=255)
    expense_type = models.CharField(max_length=255)
    category = models.CharField(max_length=255, null=True, blank=True)
    description = models.CharField(max_length=255, null=True, blank=True)
    amount = models.FloatField(null=True, blank=True)
    payment_date = models.DateField(null=True, blank=True)
    payment_mode = models.CharField(max_length=255, null=True, blank=True)
    payment_status = models.CharField(max_length=255, null=True, blank=True)
    reference_number = models.CharField(max_length=255, null=True, blank=True)
    advocate = models.ForeignKey(Advocate, on_delete=models.DO_NOTHING, db_column='advocate_id')
    case = models.ForeignKey(Case, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='case_id')
    client = models.ForeignKey(Client, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='client_id')

    class Meta:
        managed = False
        db_table = 'expenses'


class Invoice(models.Model):
    id = models.BigAutoField(primary_key=True)
    invoice_number = models.CharField(max_length=255, unique=True)
    amount = models.FloatField()
    invoice_date = models.DateField()
    due_date = models.DateField()
    status = models.CharField(max_length=255)
    advocate = models.ForeignKey(Advocate, on_delete=models.DO_NOTHING, db_column='advocate_id')
    case = models.ForeignKey(Case, on_delete=models.DO_NOTHING, db_column='case_id')
    client = models.ForeignKey(Client, on_delete=models.DO_NOTHING, db_column='client_id')

    class Meta:
        managed = False
        db_table = 'invoices'


class ClientPayment(models.Model):
    id = models.BigAutoField(primary_key=True)
    amount = models.FloatField(null=True, blank=True)
    description = models.CharField(max_length=255, null=True, blank=True)
    payment_date = models.DateField(null=True, blank=True)
    payment_mode = models.CharField(max_length=255, null=True, blank=True)
    reference_number = models.CharField(max_length=255, null=True, blank=True)
    advocate = models.ForeignKey(Advocate, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='advocate_id')
    case = models.ForeignKey(Case, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='case_id')
    client = models.ForeignKey(Client, on_delete=models.DO_NOTHING, null=True, blank=True, db_column='client_id')

    class Meta:
        managed = False
        db_table = 'client_payments'


class PasswordResetOtp(models.Model):
    id = models.BigAutoField(primary_key=True)
    advocate_id = models.BigIntegerField()
    email = models.CharField(max_length=255)
    hashed_otp = models.CharField(max_length=255)
    created_at = models.DateTimeField()
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    class Meta:
        managed = False
        db_table = 'password_reset_otp'


class AuditLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    action_type = models.CharField(max_length=255)
    title = models.CharField(max_length=255)
    description = models.CharField(max_length=255, null=True, blank=True)
    module = models.CharField(max_length=255, null=True, blank=True)
    entity_type = models.CharField(max_length=255, null=True, blank=True)
    entity_id = models.BigIntegerField(null=True, blank=True)
    status = models.CharField(max_length=255, null=True, blank=True)
    user_name = models.CharField(max_length=255, null=True, blank=True)
    ip_address = models.CharField(max_length=255, null=True, blank=True)
    device = models.CharField(max_length=255, null=True, blank=True)
    browser = models.CharField(max_length=255, null=True, blank=True)
    operating_system = models.CharField(max_length=255, null=True, blank=True)
    request_method = models.CharField(max_length=255, null=True, blank=True)
    request_uri = models.CharField(max_length=255, null=True, blank=True)
    metadata = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField()
    advocate_id = models.BigIntegerField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'audit_log'


class Activity(models.Model):
    id = models.BigAutoField(primary_key=True)
    action_type = models.CharField(max_length=255, null=True, blank=True)
    description = models.CharField(max_length=255)
    timestamp = models.DateTimeField()
    advocate_id = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'activities'


class CommunicationSettings(models.Model):
    id = models.BigAutoField(primary_key=True)
    email_enabled = models.BooleanField(default=True)
    email_signature = models.TextField(null=True, blank=True)
    encrypted_password = models.CharField(max_length=255, null=True, blank=True)
    max_retry_count = models.IntegerField(default=3)
    office_address = models.CharField(max_length=255, null=True, blank=True)
    queue_enabled = models.BooleanField(default=True)
    reply_to_email = models.CharField(max_length=255, null=True, blank=True)
    retry_delay_minutes = models.IntegerField(default=5)
    sender_email = models.CharField(max_length=255, null=True, blank=True)
    sender_name = models.CharField(max_length=255, null=True, blank=True)
    smtp_host = models.CharField(max_length=255, null=True, blank=True)
    smtp_port = models.IntegerField(null=True, blank=True)
    website = models.CharField(max_length=255, null=True, blank=True)
    whatsapp_access_token = models.CharField(max_length=255, null=True, blank=True)
    whatsapp_business_account_id = models.CharField(max_length=255, null=True, blank=True)
    whatsapp_enabled = models.BooleanField(default=False)
    whatsapp_phone_number_id = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    advocate_id = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'communication_settings'


class NotificationTemplate(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255)
    channel = models.CharField(max_length=255)
    type = models.CharField(max_length=255)
    subject_template = models.TextField(null=True, blank=True)
    body_template = models.TextField()
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    advocate_id = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'notification_templates'


class NotificationHistory(models.Model):
    id = models.BigAutoField(primary_key=True)
    type = models.CharField(max_length=255)
    channel = models.CharField(max_length=255)
    status = models.CharField(max_length=255)
    recipient = models.CharField(max_length=255, null=True, blank=True)
    recipient_name = models.CharField(max_length=255, null=True, blank=True)
    recipient_email = models.CharField(max_length=255, null=True, blank=True)
    recipient_phone = models.CharField(max_length=255, null=True, blank=True)
    subject = models.CharField(max_length=255, null=True, blank=True)
    message = models.TextField(null=True, blank=True)
    body = models.TextField(null=True, blank=True)
    event_type = models.CharField(max_length=255, null=True, blank=True)
    template_used = models.CharField(max_length=255, null=True, blank=True)
    triggered_by = models.CharField(max_length=255, null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)
    failure_reason = models.TextField(null=True, blank=True)
    provider_response = models.TextField(null=True, blank=True)
    response_body = models.TextField(null=True, blank=True)
    meta_message_id = models.CharField(max_length=255, null=True, blank=True)
    status_code = models.IntegerField(null=True, blank=True)
    retry_count = models.IntegerField(null=True, blank=True)
    entity = models.CharField(max_length=255, null=True, blank=True)
    entity_id = models.BigIntegerField(null=True, blank=True)
    sent_at = models.DateTimeField()
    failed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField()
    advocate_id = models.BigIntegerField()
    case_id = models.BigIntegerField(null=True, blank=True)
    client_id = models.BigIntegerField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'notification_history'


class NotificationLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    log_level = models.CharField(max_length=255)
    message = models.CharField(max_length=255)
    channel = models.CharField(max_length=255, null=True, blank=True)
    event_type = models.CharField(max_length=255, null=True, blank=True)
    recipient = models.CharField(max_length=255, null=True, blank=True)
    details = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField()
    advocate_id = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'notification_logs'


class NotificationQueue(models.Model):
    id = models.BigAutoField(primary_key=True)
    type = models.CharField(max_length=255)
    status = models.CharField(max_length=255)
    payload_json = models.TextField()
    retry_count = models.IntegerField(default=0)
    max_retries = models.IntegerField(default=3)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    processing_started_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField()
    advocate_id = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'notification_queue'


class BackupHistory(models.Model):
    id = models.BigAutoField(primary_key=True)
    backup_type = models.CharField(max_length=255)
    file_name = models.CharField(max_length=255)
    file_size = models.BigIntegerField(null=True, blank=True)
    checksum = models.CharField(max_length=255, null=True, blank=True)
    duration_seconds = models.BigIntegerField(null=True, blank=True)
    metadata_json = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=255)
    created_at = models.DateTimeField()
    advocate_id = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'backup_history'


class Notification(models.Model):
    id = models.BigAutoField(primary_key=True)
    created_at = models.DateTimeField()
    message = models.CharField(max_length=255)
    read_status = models.BooleanField(default=False)
    advocate_id = models.BigIntegerField()
    # What this notification is about, so clicking it can go somewhere.
    # Added by `manage.py add_notification_links`; null on rows written before
    # that, which stay unlinked because there is no way to work out what they
    # referred to after the fact.
    entity_type = models.CharField(max_length=50, null=True, blank=True)
    entity_id = models.BigIntegerField(null=True, blank=True)
    case_id = models.BigIntegerField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'notifications'
