"""Zdjęcia profilowe: przetwarzanie wysłanego obrazu i adres, pod którym jest dostępny.

Każde zdjęcie jest obracane zgodnie z danymi EXIF (zdjęcia z telefonu), kadrowane do kwadratu
(środek kadru), zmniejszane do 256×256 px i zapisywane jako WebP. Oryginał nie jest przechowywany,
więc nie zostają też metadane (np. położenie GPS z aparatu).
"""
import io
import time

from django.db import transaction
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import Avatar, UserProfile

SIZE = 256
MAX_UPLOAD_BYTES = 8 * 1024 * 1024        # 8 MB - typowe zdjęcie z telefonu mieści się z zapasem
MAX_PIXELS = 50_000_000                   # ochrona przed „bombą dekompresyjną”


class AvatarError(ValueError):
    """Nieprawidłowy plik - komunikat dla użytkownika."""


def avatar_url(user_id: int, version: int | None) -> str | None:
    return f'/api/avatars/{user_id}/?v={version}' if version else None


def avatar_url_for(user) -> str | None:
    profile = getattr(user, 'profile', None)
    return avatar_url(user.id, getattr(profile, 'avatar_version', None))


def process(upload) -> bytes:
    """Wysłany plik -> kwadrat 256 px WebP. Zgłasza AvatarError dla plików, które nie są obrazem."""
    if upload.size > MAX_UPLOAD_BYTES:
        raise AvatarError('Plik jest za duży (maks. 8 MB).')
    try:
        image = Image.open(upload)
        if image.width * image.height > MAX_PIXELS:
            raise AvatarError('Obraz ma zbyt dużą rozdzielczość.')
        image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise AvatarError('To nie jest obsługiwany obraz (JPG, PNG, WebP, GIF).') from e
    image = ImageOps.exif_transpose(image)
    if image.mode not in ('RGB', 'RGBA'):
        image = image.convert('RGBA' if 'transparency' in image.info or image.mode in ('LA', 'P') else 'RGB')
    image = ImageOps.fit(image, (SIZE, SIZE), method=Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, 'WEBP', quality=82, method=6)
    return out.getvalue()


@transaction.atomic
def save(user, upload) -> str:
    data = process(upload)
    Avatar.objects.update_or_create(user=user, defaults={'image': data})
    version = time.time_ns() // 1_000_000
    UserProfile.objects.filter(user=user).update(avatar_version=version)
    return avatar_url(user.id, version)


@transaction.atomic
def remove(user) -> None:
    Avatar.objects.filter(user=user).delete()
    UserProfile.objects.filter(user=user).update(avatar_version=None)
