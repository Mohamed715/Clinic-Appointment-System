import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clinic', '0002_specialization'),
    ]

    operations = [
        migrations.AddField(
            model_name='appointment',
            name='postpone_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='appointment',
            name='transfer_count',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterField(
            model_name='activitylog',
            name='action',
            field=models.CharField(choices=[('LOGIN', 'Signed in'), ('LOGIN_FAILED', 'Failed sign in'), ('LOGOUT', 'Signed out'), ('CREATE', 'Created'), ('UPDATE', 'Updated'), ('DELETE', 'Deleted')], max_length=20),
        ),
        migrations.AlterField(
            model_name='appointment',
            name='status',
            field=models.CharField(choices=[('BOOKED', 'Waiting for approval'), ('APPROVED', 'Approved'), ('REJECTED', 'Rejected'), ('CANCELLED', 'Cancelled'), ('POSTPONED', 'Postponed'), ('TRANSFERRED', 'Transferred'), ('VISITED', 'Visited'), ('COMPLETED', 'Completed')], default='BOOKED', max_length=20),
        ),
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('message', models.CharField(max_length=255)),
                ('is_read', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('appointment', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='clinic.appointment')),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='clinic.patient')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]