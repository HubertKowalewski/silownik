"""Każde nowe konto (także utworzone przez createsuperuser) otrzymuje profil."""
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import HealthProfile, UserProfile


@receiver(post_save, sender=User)
def create_profiles(sender, instance, created, raw=False, **kwargs):
    # raw = wczytywanie kopii danych (loaddata) - profile przychodzą wtedy z kopii, nie tworzymy własnych
    if created and not raw:
        UserProfile.objects.get_or_create(user=instance)
        HealthProfile.objects.get_or_create(user=instance)
