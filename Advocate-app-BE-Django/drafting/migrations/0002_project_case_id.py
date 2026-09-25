"""Project.ams_case_id -> Project.case_id. With drafting inside AMS there is no
separate system to mirror: it is simply the AMS case id (a plain integer, no foreign
key into the Spring-owned `cases` table). Renames the column; existing links are kept."""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('drafting', '0001_initial'),
    ]

    operations = [
        migrations.RenameField(model_name='project', old_name='ams_case_id', new_name='case_id'),
    ]
