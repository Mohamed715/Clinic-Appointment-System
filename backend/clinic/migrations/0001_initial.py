
import django.contrib.auth.models
import django.contrib.auth.validators
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.CreateModel(
            name='User',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('password', models.CharField(max_length=128, verbose_name='password')),
                ('last_login', models.DateTimeField(blank=True, null=True, verbose_name='last login')),
                ('is_superuser', models.BooleanField(default=False, help_text='Designates that this user has all permissions without explicitly assigning them.', verbose_name='superuser status')),
                ('username', models.CharField(error_messages={'unique': 'A user with that username already exists.'}, help_text='Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only.', max_length=150, unique=True, validators=[django.contrib.auth.validators.UnicodeUsernameValidator()], verbose_name='username')),
                ('first_name', models.CharField(blank=True, max_length=150, verbose_name='first name')),
                ('last_name', models.CharField(blank=True, max_length=150, verbose_name='last name')),
                ('email', models.EmailField(blank=True, max_length=254, verbose_name='email address')),
                ('is_staff', models.BooleanField(default=False, help_text='Designates whether the user can log into this admin site.', verbose_name='staff status')),
                ('is_active', models.BooleanField(default=True, help_text='Designates whether this user should be treated as active. Unselect this instead of deleting accounts.', verbose_name='active')),
                ('date_joined', models.DateTimeField(default=django.utils.timezone.now, verbose_name='date joined')),
                ('role', models.CharField(choices=[('MANAGER', 'Clinic Manager'), ('DOCTOR', 'Doctor'), ('RECEPTIONIST', 'Receptionist'), ('PATIENT', 'Patient')], default='PATIENT', max_length=20)),
                ('phone', models.CharField(blank=True, max_length=30)),
                ('groups', models.ManyToManyField(blank=True, help_text='The groups this user belongs to. A user will get all permissions granted to each of their groups.', related_name='user_set', related_query_name='user', to='auth.group', verbose_name='groups')),
                ('user_permissions', models.ManyToManyField(blank=True, help_text='Specific permissions for this user.', related_name='user_set', related_query_name='user', to='auth.permission', verbose_name='user permissions')),
            ],
            options={
                'verbose_name': 'user',
                'verbose_name_plural': 'users',
                'abstract': False,
            },
            managers=[
                ('objects', django.contrib.auth.models.UserManager()),
            ],
        ),
        migrations.CreateModel(
            name='ActivityLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(choices=[('LOGIN', 'Signed in'), ('LOGIN_FAILED', 'Failed sign in'), ('LOGOUT', 'Signed out'), ('CREATE', 'Created'), ('UPDATE', 'Updated')], max_length=20)),
                ('description', models.CharField(max_length=255)),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='activity_logs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'activity log',
                'verbose_name_plural': 'activity log',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='Doctor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('full_name', models.CharField(max_length=120)),
                ('specialization', models.CharField(max_length=100)),
                ('room', models.CharField(blank=True, max_length=20)),
                ('phone', models.CharField(blank=True, max_length=30)),
                ('is_active', models.BooleanField(default=True)),
                ('user_account', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='doctor_profile', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['full_name'],
            },
        ),
        migrations.CreateModel(
            name='Patient',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('full_name', models.CharField(max_length=120)),
                ('phone', models.CharField(max_length=30)),
                ('gender', models.CharField(choices=[('F', 'Female'), ('M', 'Male')], max_length=1)),
                ('date_of_birth', models.DateField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user_account', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='patient_profile', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['full_name'],
            },
        ),
        migrations.CreateModel(
            name='Slot',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField()),
                ('time', models.TimeField()),
                ('is_blocked', models.BooleanField(default=False)),
                ('is_booked', models.BooleanField(default=False)),
                ('doctor', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='slots', to='clinic.doctor')),
            ],
            options={
                'ordering': ['date', 'time'],
            },
        ),
        migrations.CreateModel(
            name='Appointment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('reason', models.CharField(max_length=200)),
                ('status', models.CharField(choices=[('BOOKED', 'Waiting for approval'), ('APPROVED', 'Approved'), ('REJECTED', 'Rejected'), ('CANCELLED', 'Cancelled'), ('COMPLETED', 'Visited')], default='BOOKED', max_length=20)),
                ('notes', models.TextField(blank=True)),
                ('reschedule_count', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='booked_appointments', to=settings.AUTH_USER_MODEL)),
                ('doctor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='appointments', to='clinic.doctor')),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='appointments', to='clinic.patient')),
                ('slot', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='appointments', to='clinic.slot')),
            ],
            options={
                'ordering': ['-slot__date', '-slot__time'],
            },
        ),
        migrations.AddConstraint(
            model_name='slot',
            constraint=models.UniqueConstraint(fields=('doctor', 'date', 'time'), name='unique_doctor_slot'),
        ),
    ]