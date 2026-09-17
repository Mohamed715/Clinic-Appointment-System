# manage.py: Django's command-line tool for this project. It loads
# config/settings.py and runs commands such as runserver, makemigrations,
# migrate and setup_clinic.

import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()