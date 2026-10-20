# Siłownik – planowanie treningu siłowego i analiza postępów

Aplikacja do pracy inżynierskiej. System składa się z dwóch warstw:

- **`backend/`** – Django 6 + Django REST Framework + Pandas/NumPy. Udostępnia REST API pod `/api/`
  (logika, obliczenia 1RM, dobór planów, raporty, uprawnienia). Nie zawiera kodu interfejsu –
  jedynie szablon `react_app.html`, który ładuje zbudowaną aplikację React.
- **`frontend/`** – React 18 + Vite. Cały interfejs, działający także jako aplikacja mobilna (PWA).
  Po `npm run build` gotowe pliki trafiają do `frontend/dist`, a Django serwuje je pod tym samym
  adresem co API (`/static/dist/`).

## Wymagania
- Python 3.12+
- Node.js 20+ – tylko do zmian we frontendzie (zbudowana wersja jest już w `frontend/dist`)

## Uruchomienie (Windows PowerShell)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser   # konto administratora (moderacja, baza ćwiczeń)
python manage.py runserver
```
Aplikacja: http://127.0.0.1:8000 · panel administratora: http://127.0.0.1:8000/admin

> **Przed `migrate` na istniejącej bazie zrób kopię `backend/db.sqlite3`.**
> Migracje 0003–0008 zachowują dane: przenoszą dotychczasowe pozycje planów do jednostki
> „Dzień A”, uzupełniają sprzęt i obciążane obszary ciała ćwiczeń oraz tworzą profile
> dla istniejących kont. Konta założone wcześniej mogą nie mieć adresu e-mail – uzupełnij go
> w zakładce Profil (potrzebny do odzyskiwania hasła).

## Import danych
Plan 4-dniowy przepisany ze zrzutów ekranu:
```powershell
cd backend
python manage.py importuj_moj_plan --user eksu            # --nadpisz: utwórz od nowa, --publiczny: opublikuj
```
Historia treningów z pliku CSV (eksport Strong, Hevy albo własny plik z kolumnami date, exercise, weight, reps,
opcjonalnie workout, rir, rpe, warmup) – w aplikacji: Profil → Import historii, albo z konsoli:
```powershell
python manage.py importuj_csv --user eksu --plik eksport.csv
```
Ponowny import tego samego pliku nie tworzy duplikatów.

## Praca nad frontendem
Terminal 1: `cd backend` i `python manage.py runserver`

Terminal 2:
```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173 – zapytania /api przekierowane do Django
```
Jeśli PowerShell blokuje skrypty npm, użyj `npm.cmd` (np. `npm.cmd run dev`) albo wiersza poleceń `cmd`.

Sprawdzenie typów TypeScript: `npm run typecheck`. Po zakończeniu zmian: `npm run build`. Bez tego http://127.0.0.1:8000 pokazuje poprzednią wersję interfejsu.

## Aplikacja w internecie (telefon + komputer, z każdej sieci)
Darmowo: aplikacja na **Render.com** (budowana z `Dockerfile`, konfiguracja w `render.yaml`), baza
PostgreSQL w **Neon** (neon.com). Adres `https://<nazwa>.onrender.com` działa na telefonie i komputerze,
z HTTPS, więc aplikację można zainstalować na ekranie głównym (PWA).

1. **GitHub** – wypchnij repozytorium (sekcja „Wdrożenie” niżej albo `git push`).
2. **Neon** – załóż konto i projekt (region *AWS Europe Central 1 – Frankfurt*), kliknij **Connect**
   i skopiuj adres połączenia (z włączonym *Connection pooling*):
   `postgresql://…@ep-…-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
3. **Dane z komputera (opcjonalnie)** – przed pierwszym uruchomieniem w chmurze, w katalogu `backend`:
   ```powershell
   python manage.py przenies_do_chmury --cel "postgresql://...adres z Neon..."
   ```
   Kopiuje konta, plany, treningi, pomiary i ustawienia (te same loginy i hasła). Zamiast tego można
   zaimportować tylko treningi: `$env:DATABASE_URL="postgresql://..."; python manage.py importuj_moj_plan ...`.
4. **Render** – załóż konto (logowanie przez GitHub), **New → Blueprint**, wybierz repozytorium i
   kliknij **Deploy Blueprint**. Render zapyta o zmienne:
   - `DATABASE_URL` – adres z Neon,
   - `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`, `DJANGO_SUPERUSER_PASSWORD` – konto
     administratora (moderacja); pomijane, jeśli takie konto już jest.

   Po kilku minutach aplikacja działa pod adresem z panelu Render. Każdy `git push` to nowa wersja.

**Plan darmowy:** po 15 minutach bez ruchu Render usypia aplikację – pierwsze wejście po przerwie trwa do
ok. minuty (aplikacja otwiera się od razu z pamięci telefonu i pokazuje „Łączę z serwerem…”, trening
można zapisywać także offline). Żeby tego uniknąć, darmowy serwis cyklicznych zapytań (np. cron-job.org)
może co 10 minut odwiedzać `https://<nazwa>.onrender.com/api/ping/` – ten adres nie łączy się z bazą,
więc baza Neon nadal zasypia i nie zużywa limitu. Limity planów darmowych sprawdź na stronach Render i Neon.

Ustawienia pod hosting: `/api/ping/` (kontrola stanu bez bazy), `RENDER_EXTERNAL_HOSTNAME` dodawany do
`ALLOWED_HOSTS`, gunicorn z `--preload` (ok. 185 MB RAM przy 2 procesach), krótkie połączenia z bazą
(`DJANGO_DB_CONN_MAX_AGE=60`), sesja logowania 90 dni.

## Na telefonie (w sieci domowej, bez wdrażania)
**W tej samej sieci Wi-Fi** (najprościej, do testów):
```powershell
python manage.py runserver 0.0.0.0:8000
ipconfig                      # adres IPv4 komputera, np. 192.168.1.23
```
Na telefonie: `http://192.168.1.23:8000`. Przy pierwszym uruchomieniu Windows zapyta o zaporę – zezwól
dla sieci prywatnej. Bez HTTPS przeglądarka nie pozwoli zainstalować aplikacji (PWA) ani używać jej offline.

**Przez internet z HTTPS i instalacją jako aplikacja** – tymczasowy tunel Cloudflare (bez konta):
```powershell
winget install --id Cloudflare.cloudflared
python manage.py runserver                       # w jednym oknie
cloudflared tunnel --url http://localhost:8000   # w drugim - wypisze adres https://....trycloudflare.com
```
Adres otwórz na telefonie, a potem „Dodaj do ekranu głównego” (Safari: Udostępnij; Chrome: menu ⋮ → Zainstaluj
aplikację). Działa, dopóki komputer i tunel są włączone; adres zmienia się przy każdym uruchomieniu tunelu.
Na stałe – wdrożenie na serwer (sekcja „Wdrożenie (Docker)”).

## Moduł mobilny (PWA)
Otwórz aplikację w przeglądarce telefonu i wybierz „Dodaj do ekranu głównego”.
Instalacja i tryb offline wymagają HTTPS (wyjątek: `localhost`). Do testów na telefonie
można użyć tunelu HTTPS (np. ngrok) i ustawić `DJANGO_ALLOWED_HOSTS` oraz `DJANGO_CSRF_ORIGINS`
na adres tunelu. Treningi, pomiary i testy zapisane bez połączenia trafiają do kolejki
w urządzeniu i są wysyłane automatycznie po odzyskaniu łączności, bez duplikatów.

## Wygląd
System wizualny „Fiolet i radełko”: fiolet jako jedyny kolor marki w motywie jasnym i ciemnym (domyślnie zgodnym
z ustawieniem systemu, przełącznik w górnym pasku), wąski krój Big Shoulders Display w tytułach i liczbach,
Onest w tekście (oba dołączone do aplikacji - działają offline), a jako jedyny ozdobnik radełkowanie, czyli
krzyżowa faktura uchwytu gryfu (pasek pod tytułem strony, wypełnienie postępu, brzeg karty akcji).
Delikatne gradienty: poświata tła, karta akcji, kafelki z liczbami, przycisk główny. Logo (`src/app/components/Logo.tsx`,
`src/assets/logo-mark.webp`, ikony PWA w `public/icons`) to odznaka z sylwetką kulturysty i nazwa „Siłownik” w tym samym gradiencie - zawsze razem.
Na telefonie nawigacja jest na dolnym pasku z przyciskiem „Trening” pośrodku. Tokeny kolorów: `src/styles/theme.css`.

## Najważniejsze funkcje
- **Społeczność (treningi):** po zakończeniu treningu przełącznik „Udostępnij trening” (domyślne ustawienie
  w profilu, zmiana później w Historii). Udostępniony trening przy profilu publicznym widzą wszyscy, przy
  prywatnym - tylko osoby obserwowane wzajemnie; notatki i tętno nigdy nie są pokazywane. Strona
  **Społeczność**: tablica „Wszystkie” (od najnowszych), „Obserwowani” i „Ludzie” (wyszukiwanie - profile
  prywatne po pełnej nazwie, listy obserwowanych i obserwujących). Obserwowanie, „brawo” pod treningiem,
  powiadomienia; zasady widoczności w `backend/training/social.py`.
- **Asystent planu („Nowy plan” → „Z pomocnikiem”):** wybór podziału (Full Body, Upper/Lower, Push/Pull/Legs,
  Push/Pull), a dla każdej części jednostki (np. „wyciskanie na klatkę”, „przyciąganie pionowe”) kilka propozycji
  ćwiczeń uszeregowanych według ankiety zdrowotnej, dostępnego sprzętu i historii treningów. Nic nie jest narzucone:
  można wybrać inną propozycję, dowolne ćwiczenie z bazy, pominąć część lub dodać własne; serie i powtórzenia
  wynikają z celu treningowego, a gotowy plan otwiera się w edytorze (`training/plan_assistant.py`).
- **Plany:** 5 gotowych szablonów (FBW, góra/dół, Push/Pull/Legs, Siła 5×5, trening w domu) oraz generator
  „Wygeneruj plan dla mnie” dobierający szablon do profilu i podmieniający ćwiczenia kolidujące z ograniczeniami
  zdrowotnymi lub brakiem sprzętu; kreator (tygodnie, jednostki, zakres powtórzeń z presetami, docelowy RIR,
  obciążenie jako % 1RM / RPE / kg, kopiowanie ćwiczeń między dniami), najczęściej używane ćwiczenia na górze listy,
  duplikowanie, dobór do profilu i ankiety zdrowotnej, klonowanie z przeliczeniem ciężarów, konsultacje z autorem.
- **Podwójna progresja:** propozycja ciężaru na dziś przy każdym ćwiczeniu z planu (zwiększ / utrzymaj / odciąż)
  na podstawie ostatnich treningów, zakresu powtórzeń i RIR.
- **Trening:** jednostka z planu, powtórzenie treningu z historii albo trening bez planu; zaliczanie serii
  jednym dotknięciem; sposób zapisu serii wybierany osobno dla każdego ćwiczenia: klasycznie (ciężar × powtórzenia), z RIR (powtórzenia w zapasie) albo z RPE - wpisane oceny przeliczają się przy zmianie, a wybór jest zapamiętywany dla ćwiczenia; szacowane 1RM każdej serii
  na bieżąco i oznaczenie rekordu; generator serii rozgrzewkowych; kalkulator talerzy dla sztangi; notatki do
  ćwiczeń (np. ustawienie maszyny); czas treningu; rekordy 1RM i powtórzeniowe w podsumowaniu.
- **Minutnik przerw:** start automatyczny po serii albo ręczny, przerwa ustawiana dla każdego ćwiczenia,
  pauza, krok ±, restart, dźwięk i wibracja; ustawienia domyślne w Profilu.
- **1RM:** liczone automatycznie (wzór Epleya, serie do 10 powtórzeń; RIR doliczany do powtórzeń, serie z RIR > 4 pomijane); wynik testu lub wpis ręczny jest
  punktem odniesienia; usunięcie treningu lub testu cofa rekord; kalkulator z tabelą % 1RM.
- **Historia:** podgląd, porównanie z planem (% realizacji), edycja, usuwanie, „Powtórz”, „Zapisz jako plan”.
- **Cele siłowe:** docelowe 1RM z terminem, postęp i prognozowana data osiągnięcia.
- **Konto:** odzyskiwanie hasła przez e-mail, zmiana e-maila, profil publiczny i widoczność treningów,
  eksport danych (JSON), usunięcie konta.
- **Statystyki:** objętość, progresja i prognoza 1RM, rekordy powtórzeniowe, siła względna, obciążenie treningowe
  (ACWR), seria tygodni z treningiem, kalendarz aktywności, bliskość upadku (rozkład RIR, średni RIR
  w tygodniach, odsetek serii do upadku), pomiary ciała, raporty PDF/CSV.
- **Raport okresowy (ekran, PDF z wykresami, CSV):** porównanie z poprzednim okresem, lista treningów z realizacją
  planu, objętość tygodniowa, serie efektywne na partię mięśniową tygodniowo, zmiany 1RM z rekordami, rekordy
  powtórzeniowe, cele, RIR, pomiary.
- **Baza ćwiczeń:** 458 ćwiczeń, w tym maszyny i odmiany bojów (m.in. martwy ciąg klasyczny, hack squat, trap bar).
- Tryb offline (PWA).

## Testy
```powershell
cd backend;  python manage.py test training     # 93 testy API i logiki (SQLite lub PostgreSQL)
cd frontend; npm test                            # 24 testy jednostkowe (Vitest): 1RM, talerze,
                                                 # rozgrzewka, kolejka offline, model treningu
```
Nazwy klas testów backendu odpowiadają identyfikatorom wymagań (np. `WF17_KlonowanieZeSkalowaniemTest`,
`WF22_ModeracjaTest`, `WN04_SynchronizacjaTest`, `WN01_WydajnoscRaportuTest`).

Pokrycie kodu backendu testami (ok. 90%):
```powershell
pip install coverage; coverage run manage.py test training; coverage report
```
Przy każdym `git push` testy, lint, kontrola ustawień produkcyjnych i budowa frontendu uruchamiają się
automatycznie w GitHub Actions (`.github/workflows/ci.yml`, backend testowany na PostgreSQL).

## Dokumentacja API
Opis wszystkich punktów końcowych (OpenAPI 3, Swagger UI): http://127.0.0.1:8000/api/docs/ – lokalnie dostępny
dla każdego, na produkcji tylko dla kont personelu. Schemat do pobrania: `/api/schema/`.

## Ankieta użyteczności (SUS)
Testerzy wypełniają ankietę w aplikacji: **Profil → Oceń aplikację** (10 stwierdzeń, skala 1–5).
Wynik 0–100 liczony jest automatycznie; zestawienie (średnia, odchylenie, średnie pytań, spełnienie progu 70
z wymagania WN-10) widzi moderator w zakładce **Moderacja**, a pojedyncze odpowiedzi – w panelu `/admin/`.

## Jakość kodu
```powershell
cd backend;  ruff check .                 # reguły w backend/pyproject.toml
cd frontend; npm run typecheck            # TypeScript w trybie strict
```

## Moderacja
Konto moderatora nadaje się poleceniem (konto musi już istnieć):
```powershell
python manage.py nadaj_moderatora jan            # --odbierz cofa uprawnienia
```
Moderator widzi w menu zakładkę **Moderacja**: zgłoszone plany i komentarze, liczbę zgłoszeń tej samej
treści, decyzje *ukryj* / *odrzuć* / *przywróć* (z uzasadnieniem dla autora) oraz blokadę konta autora.
Autor i zgłaszający dostają powiadomienia. Te same akcje są dostępne w panelu `/admin/`.

## Wdrożenie (Docker)
Na serwerze z Dockerem i domeną skierowaną na jego adres IP:
```bash
cp .env.example .env          # uzupełnij: DOMAIN, DJANGO_SECRET_KEY, hasła, SMTP
docker compose up -d --build
```
Uruchamiane są trzy kontenery:
- **db** – PostgreSQL 16 (dane w wolumenie `db-data`),
- **web** – aplikacja: przy starcie migracje bazy i konto administratora z `.env`, następnie
  serwer `gunicorn`; pliki statyczne i frontend serwuje WhiteNoise (kompresja, cache plików z hashem),
- **caddy** – odwrotne proxy z automatycznym certyfikatem HTTPS (Let's Encrypt).

Przydatne polecenia:
```bash
docker compose logs -f web                                   # dziennik aplikacji
docker compose exec web python manage.py nadaj_moderatora jan
docker compose exec db pg_dump -U silownik silownik > kopia.sql   # kopia zapasowa bazy
docker compose up -d --build                                 # aktualizacja po zmianach w kodzie
```
Stan serwera: `GET /api/health/` (używany też przez Dockera do kontroli kontenera).

### Bez Dockera
```bash
cd frontend && npm ci && npm run build
cd ../backend && pip install -r requirements.txt
export DJANGO_DEBUG=0 DJANGO_SECRET_KEY=... DATABASE_URL=postgres://... DJANGO_ALLOWED_HOSTS=moja-domena.pl
python manage.py migrate && python manage.py collectstatic --noinput
gunicorn core.wsgi:application --bind 127.0.0.1:8000     # za nginx/Caddy z HTTPS
```

## Zmienne środowiskowe
| Zmienna | Znaczenie |
|---|---|
| `DJANGO_DEBUG` | `0` na produkcji (domyślnie `1`) |
| `DJANGO_SECRET_KEY` | wymagany, gdy `DJANGO_DEBUG=0` |
| `DJANGO_ALLOWED_HOSTS` | lista domen oddzielonych przecinkami |
| `DJANGO_CSRF_ORIGINS` | np. `https://moja-domena.pl` |
| `DATABASE_URL` | np. `postgres://uzytkownik:haslo@host:5432/baza`; bez niej – lokalny plik SQLite |
| `DJANGO_SSL_REDIRECT`, `DJANGO_HSTS_SECONDS` | przekierowanie na HTTPS (domyślnie włączone) i czas HSTS |
| `DJANGO_ADMINS` | adresy e-mail, na które trafiają raporty o błędach serwera |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | serwer SMTP do wysyłki linków zmiany hasła |
| `DEFAULT_FROM_EMAIL` | nadawca wiadomości |
| `GUNICORN_WORKERS` | liczba procesów serwera (domyślnie 3) |

Bez `EMAIL_HOST` wiadomości nie są wysyłane, tylko wypisywane w konsoli serwera, razem z linią
`[DEV] Link do zmiany hasła…` – tak testujesz odzyskiwanie hasła lokalnie.

## Struktura
```
backend/
  core/                ustawienia, adresy URL
  training/
    models.py          model danych (18 encji z modelem User)
    serializers.py     walidacja i serializacja danych API
    views/             REST API, podzielone tematycznie:
      account.py         konto, profil, prywatność, powiadomienia, reset i zmiana hasła
      exercises.py       baza ćwiczeń, notatki
      sessions.py        treningi, pomiary, testy, 1RM, import CSV
      plans.py           plany, szablony, dobór, klonowanie, konsultacje
      stats.py           pulpit, statystyki, cele, raporty
      moderation.py      panel moderatora (zgłoszenia, decyzje, blokady)
      spa.py             serwowanie aplikacji React, plików PWA, kontrola stanu
      common.py          elementy wspólne (m.in. zapis idempotentny)
    analytics/         obliczenia (Pandas/NumPy):
      core.py            DataFrame serii, estymacja i wyznaczanie 1RM
      planning.py        skalowanie planu, dobór, podwójna progresja, realizacja planu
      statistics.py      statystyki, RIR, rekordy powtórzeniowe, obciążenie, cele
      report.py          raport okresowy
    moderation.py      logika decyzji moderatora (wspólna dla API i panelu admina)
    plan_assistant.py  asystent tworzenia planu (podziały, miejsca na ćwiczenia, propozycje)
    plan_templates.py  szablony planów i generator
    importers.py       import historii z CSV (Strong, Hevy, szablon)
    reports.py         eksport raportu do CSV i PDF (z wykresami)
    tests.py           testy automatyczne
    migrations/        migracje (m.in. uzupełnienie bazy ćwiczeń do 458 pozycji)
Dockerfile, docker-compose.yml, deploy/Caddyfile, .env.example   wdrożenie
frontend/
  src/lib/             klient API, kolejka offline, pamięć lokalna, formatowanie, obliczenia 1RM,
                       rozgrzewka i talerze (testy jednostkowe: *.test.ts)
  src/app/components/  strony aplikacji (ładowane osobno, z doczytaniem w tle do pracy offline)
    workout/           ekran treningu: model danych, logika (useWorkout), karty ćwiczeń i serii
  public/              manifest PWA, service worker, ikony
  dist/                wynik `npm run build` – generowany, nie edytuj ręcznie
```
