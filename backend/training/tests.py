"""Testy automatyczne. Nazwa klasy wskazuje weryfikowane wymaganie (WF-nn / WN-nn)."""
import tempfile
import time
import uuid
from datetime import timedelta
from io import StringIO

from django.contrib.auth.models import User
from django.core.management import CommandError, call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from training.analytics import epley_1rm, round_down
from training.models import (
    BodyArea,
    ContentReport,
    Exercise,
    ExerciseSet,
    HealthProfile,
    Notification,
    PersonalRecord,
    WorkoutPlan,
    WorkoutSession,
)

HASLO = 'Trudne123!x'


def klient(username):
    c = APIClient()
    r = c.post('/api/auth/register/', {'username': username, 'email': f'{username}@test.pl',
                                       'password': HASLO, 'password2': HASLO}, format='json')
    assert r.status_code == 201, r.content
    return c


def cwiczenie(nazwa='Przysiad testowy', grupa='Nogi', sprzet='barbell', obszary=()):
    ex = Exercise.objects.create(name=nazwa, muscle_group=grupa, equipment=sprzet)
    ex.stressed_areas.set([BodyArea.objects.get(code=c) for c in obszary])
    return ex


def plan_payload(ex, load_type='percent', value=80, public=True, **meta):
    return {'title': 'Plan siłowy', 'is_public': public, 'level': 'beginner', 'goal': 'strength',
            'days_per_week': 3, 'required_equipment': ['barbell'], **meta,
            'days': [{'name': 'Dzień A', 'week': 1, 'exercises': [
                {'exercise': ex.id, 'target_sets': 3, 'target_reps': 5,
                 'load_type': load_type, 'load_value': value, 'rest_seconds': 180}]}]}


def trening(c, ex, ciezar, powt=5, rir=None, **extra):
    seria = {'exercise': ex.id, 'set_number': 1, 'weight': ciezar, 'reps': powt}
    if rir is not None:
        seria['rir'] = rir
    return c.post('/api/sessions/', {'sets': [seria], **extra}, format='json')


class WF30_Estymacja1RMTest(TestCase):
    def test_wzor_epleya(self):
        self.assertAlmostEqual(epley_1rm(100, 5), 116.67, places=2)
        self.assertEqual(epley_1rm(100, 1), 100.0)
        self.assertEqual(epley_1rm(0, 5), 0.0)

    def test_zaokraglenie_w_dol(self):
        self.assertEqual(round_down(56.0), 55.0)
        self.assertEqual(round_down(57.4, 1.25), 56.25)

    def test_serie_powyzej_10_powtorzen_nie_sa_estymowane(self):
        c, ex = klient('adam'), cwiczenie()
        trening(c, ex, 50, powt=15)
        r = c.get(f'/api/sessions/last-for-exercise/{ex.id}/')
        self.assertEqual(r.json()['estimated_1rm'], 0.0)


class WF01_KontoTest(TestCase):
    def test_rejestracja_tworzy_profile(self):
        klient('adam')
        user = User.objects.get(username='adam')
        self.assertTrue(hasattr(user, 'profile') and hasattr(user, 'health'))

    def test_niezalogowany_nie_ma_dostepu(self):
        self.assertEqual(APIClient().get('/api/stats/').status_code, 403)


class WF03_AnkietaZdrowotnaTest(TestCase):
    def test_ograniczenia_zapisywane_tylko_po_zgodzie(self):
        c = klient('adam')
        bark = BodyArea.objects.get(code='bark')
        c.put('/api/profile/', {'health_consent': False, 'restrictions': [bark.id]}, format='json')
        self.assertFalse(HealthProfile.objects.get(user__username='adam').restrictions.exists())
        r = c.put('/api/profile/', {'health_consent': True, 'restrictions': [bark.id]}, format='json')
        self.assertEqual(r.json()['restrictions'], [bark.id])

    def test_cofniecie_zgody_usuwa_dane_o_zdrowiu(self):
        c = klient('adam')
        bark = BodyArea.objects.get(code='bark')
        c.put('/api/profile/', {'health_consent': True, 'restrictions': [bark.id],
                                'health_notes': 'kontuzja'}, format='json')
        c.put('/api/profile/', {'health_consent': False}, format='json')
        health = HealthProfile.objects.get(user__username='adam')
        self.assertFalse(health.restrictions.exists())
        self.assertEqual(health.notes, '')


class WF05_UsuniecieIEksportTest(TestCase):
    def test_eksport_i_usuniecie_konta(self):
        c, ex = klient('adam'), cwiczenie()
        trening(c, ex, 100)
        r = c.get('/api/auth/export/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('sessions', r.json())
        self.assertEqual(c.delete('/api/auth/me/', {'password': 'zle'}, format='json').status_code, 400)
        self.assertEqual(c.delete('/api/auth/me/', {'password': HASLO}, format='json').status_code, 204)
        self.assertFalse(WorkoutSession.objects.exists())


class WF08_TworzeniePlanuTest(TestCase):
    def test_plan_z_dniami_i_trybami_obciazenia(self):
        c, ex = klient('adam'), cwiczenie()
        r = c.post('/api/plans/', plan_payload(ex, 'rpe', 8), format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()['days'][0]['exercises'][0]['load_type'], 'rpe')

    def test_walidacja_wartosci_obciazenia(self):
        c, ex = klient('adam'), cwiczenie()
        self.assertEqual(c.post('/api/plans/', plan_payload(ex, 'rpe', 15), format='json').status_code, 400)

    def test_cudzego_planu_nie_mozna_edytowac(self):
        a, ex = klient('autor'), cwiczenie()
        plan_id = a.post('/api/plans/', plan_payload(ex), format='json').json()['id']
        b = klient('obcy')
        self.assertEqual(b.patch(f'/api/plans/{plan_id}/', {'title': 'Hack'}, format='json').status_code, 403)


class WF14_DoborPlanuTest(TestCase):
    def test_ostrzezenie_i_zamienniki_przy_kolizji(self):
        barkowe = cwiczenie('Wyciskanie nad głowę', 'Barki (test)', obszary=['bark'])
        cwiczenie('Unoszenie bokiem na maszynie', 'Barki (test)', sprzet='machine')
        a = klient('autor')
        plan_id = a.post('/api/plans/', plan_payload(barkowe), format='json').json()['id']
        u = klient('uzytkownik')
        u.put('/api/profile/', {'health_consent': True,
                                'restrictions': [BodyArea.objects.get(code='bark').id]}, format='json')
        m = u.get(f'/api/plans/{plan_id}/match/').json()
        self.assertEqual(len(m['warnings']), 1)
        self.assertEqual(m['warnings'][0]['substitutes'][0]['name'], 'Unoszenie bokiem na maszynie')

    def test_ocena_zgodnosci_pelne_dopasowanie(self):
        ex = cwiczenie()
        a = klient('autor')
        plan_id = a.post('/api/plans/', plan_payload(ex), format='json').json()['id']
        u = klient('uzytkownik')
        u.put('/api/profile/', {'level': 'beginner', 'goal': 'strength', 'days_per_week': 3,
                                'equipment': ['barbell']}, format='json')
        self.assertEqual(u.get(f'/api/plans/{plan_id}/match/').json()['score'], 100)
        self.assertEqual(u.get('/api/plans/recommended/').json()[0]['match_score'], 100)


class WF17_KlonowanieZeSkalowaniemTest(TestCase):
    def setUp(self):
        self.ex = cwiczenie()
        self.autor = klient('autor')
        self.plan_id = self.autor.post('/api/plans/', plan_payload(self.ex), format='json').json()['id']

    def test_skalowanie_wg_procentu_1rm(self):
        k = klient('klonujacy')
        trening(k, self.ex, 60)  # 1RM = 60 * (1 + 5/30) = 70 kg
        r = k.post(f'/api/plans/{self.plan_id}/fork/', {'share_progress': True}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['scaled_exercises_data'][0]['suggested_weight'], 55.0)
        forked = WorkoutPlan.objects.get(pk=r.json()['forked_plan_id'])
        self.assertEqual(forked.parent_plan_id, self.plan_id)
        self.assertTrue(Notification.objects.filter(user__username='autor').exists())

    def test_wf18_brak_1rm_wymaga_kalibracji_a_test_ja_uzupelnia(self):
        k = klient('klonujacy')
        r = k.post(f'/api/plans/{self.plan_id}/fork/', format='json')
        self.assertTrue(r.json()['scaled_exercises_data'][0]['needs_calibration'])
        forked_id = r.json()['forked_plan_id']
        # WF-27: test 3RM 90 kg -> 1RM = 99 kg; 80% = 79,2 kg -> 77,5 kg
        k.post('/api/tests/', {'exercise': self.ex.id, 'protocol': '3rm', 'weight': 90, 'reps': 3},
               format='json')
        pos = k.post(f'/api/plans/{forked_id}/recalculate/').json()['days'][0]['exercises'][0]
        self.assertFalse(pos['needs_calibration'])
        self.assertEqual(pos['calculated_weight'], 77.5)

    def test_wynik_testu_ma_pierwszenstwo_przed_estymacja(self):
        k = klient('klonujacy')
        trening(k, self.ex, 60)  # estymacja 70 kg
        k.post('/api/tests/', {'exercise': self.ex.id, 'protocol': '1rm', 'weight': 65, 'reps': 1},
               format='json')
        self.assertEqual(PersonalRecord.objects.get(user__username='klonujacy').source, 'test')
        r = k.get(f'/api/plans/{self.plan_id}/fork-preview/')
        self.assertEqual(r.json()['items'][0]['suggested_weight'], 50.0)  # 0,8 * 65 = 52 -> 50

    def test_nie_mozna_klonowac_wlasnego_planu(self):
        self.assertEqual(self.autor.post(f'/api/plans/{self.plan_id}/fork/').status_code, 400)


class WF19_KonsultacjaTest(TestCase):
    def test_pytanie_w_watku_i_powiadomienia(self):
        ex = cwiczenie()
        a = klient('autor')
        plan_id = a.post('/api/plans/', plan_payload(ex), format='json').json()['id']
        k = klient('klonujacy')
        forked_id = k.post(f'/api/plans/{plan_id}/fork/').json()['forked_plan_id']
        # pytanie zadane z poziomu kopii trafia do wątku planu oryginalnego
        q = k.post(f'/api/plans/{forked_id}/comments/', {'text': 'Ile przerwy?'}, format='json')
        self.assertEqual(q.status_code, 201)
        self.assertEqual(q.json()['plan'], plan_id)
        a.post(f'/api/plans/{plan_id}/comments/', {'text': '3 minuty', 'parent': q.json()['id']},
               format='json')
        self.assertEqual(len(a.get(f'/api/plans/{plan_id}/comments/').json()['comments']), 2)
        self.assertTrue(Notification.objects.filter(user__username='klonujacy',
                                                    text__contains='odpowiedział').exists())


class WF20_WgladWPostepyTest(TestCase):
    def test_postepy_widoczne_tylko_za_zgoda(self):
        ex = cwiczenie()
        a = klient('autor')
        plan_id = a.post('/api/plans/', plan_payload(ex), format='json').json()['id']
        klient('bez_zgody').post(f'/api/plans/{plan_id}/fork/', {'share_progress': False}, format='json')
        klient('ze_zgoda').post(f'/api/plans/{plan_id}/fork/', {'share_progress': True}, format='json')
        followers = {f['username']: f for f in a.get(f'/api/plans/{plan_id}/followers/').json()}
        self.assertNotIn('progress', followers['bez_zgody'])
        self.assertIn('progress', followers['ze_zgoda'])
        self.assertEqual(klient('obcy').get(f'/api/plans/{plan_id}/followers/').status_code, 403)


class WF28_PomiaryTest(TestCase):
    def test_zapis_i_walidacja_pomiarow(self):
        c = klient('adam')
        self.assertEqual(c.post('/api/measurements/', {'body_weight': 80, 'resting_hr': 60},
                                format='json').status_code, 201)
        self.assertEqual(c.post('/api/measurements/', {'body_weight': 900}, format='json').status_code, 400)
        self.assertEqual(c.post('/api/measurements/', {}, format='json').status_code, 400)
        self.assertEqual(len(c.get('/api/stats/').json()['measurements']), 1)


class WF33_PrognozaTest(TestCase):
    def test_prognoza_rosnacego_trendu(self):
        c, ex = klient('adam'), cwiczenie()
        for week, weight in enumerate([80, 85, 90, 95]):
            trening(c, ex, weight, date_completed=(timezone.now() - timedelta(weeks=3 - week)).isoformat())
        pred = c.get(f'/api/stats/?exercise={ex.id}').json()['prediction']
        self.assertEqual(len(pred), 4)
        self.assertGreater(pred[-1]['predicted'], pred[0]['predicted'])


class WF34_RaportTest(TestCase):
    def test_raport_json_csv_pdf(self):
        c, ex = klient('adam'), cwiczenie()
        trening(c, ex, 100)
        self.assertEqual(c.get('/api/reports/').json()['total_tonnage'], 500)
        self.assertIn('Ćwiczenie', c.get('/api/reports/?export=csv').content.decode('utf-8'))
        pdf = c.get('/api/reports/?export=pdf')
        self.assertEqual(pdf['Content-Type'], 'application/pdf')
        self.assertTrue(pdf.content.startswith(b'%PDF'))


class WN01_WydajnoscRaportuTest(TestCase):
    def test_raport_z_roku_danych_ponizej_2_sekund(self):
        c = klient('adam')
        user = User.objects.get(username='adam')
        exs = [cwiczenie(f'Ćwiczenie {i}') for i in range(6)]
        start = timezone.now() - timedelta(days=364)
        for day in range(0, 364, 2):  # ok. 180 sesji x 18 serii = ok. 3300 serii
            s = WorkoutSession.objects.create(user=user, date_completed=start + timedelta(days=day))
            ExerciseSet.objects.bulk_create([
                ExerciseSet(session=s, exercise=ex, set_number=n, weight=60 + day / 10, reps=5)
                for ex in exs for n in range(1, 4)])
        t0 = time.perf_counter()
        r = c.get(f'/api/reports/?from={start.date().isoformat()}&export=pdf')
        elapsed = time.perf_counter() - t0
        self.assertEqual(r.status_code, 200)
        self.assertLess(elapsed, 2.0, f'Raport generował się {elapsed:.2f} s')


class WN04_SynchronizacjaTest(TestCase):
    def test_ponowne_przeslanie_nie_tworzy_duplikatu(self):
        c, ex = klient('adam'), cwiczenie()
        uid = str(uuid.uuid4())
        self.assertEqual(trening(c, ex, 100, client_uuid=uid).status_code, 201)
        self.assertEqual(trening(c, ex, 100, client_uuid=uid).status_code, 200)
        self.assertEqual(WorkoutSession.objects.count(), 1)

    def test_cudzy_identyfikator_odrzucony(self):
        ex, uid = cwiczenie(), str(uuid.uuid4())
        trening(klient('adam'), ex, 100, client_uuid=uid)
        self.assertEqual(trening(klient('ewa'), ex, 100, client_uuid=uid).status_code, 400)


class WN08_AutoryzacjaTest(TestCase):
    def test_prywatny_plan_niewidoczny_dla_innych(self):
        ex = cwiczenie()
        a = klient('autor')
        plan_id = a.post('/api/plans/', plan_payload(ex, public=False), format='json').json()['id']
        self.assertEqual(klient('obcy').get(f'/api/plans/{plan_id}/').status_code, 404)

    def test_cudze_pomiary_niewidoczne(self):
        klient('adam').post('/api/measurements/', {'body_weight': 80}, format='json')
        self.assertEqual(klient('ewa').get('/api/measurements/').json()['count'], 0)


class WF30_PrzeliczanieRekordowTest(TestCase):
    """1RM liczone od zera: usunięcie danych cofa rekord, test resetuje poziom odniesienia."""

    def setUp(self):
        self.c, self.ex = klient('adam'), cwiczenie()

    def rekord(self):
        return self.c.get('/api/one-rep-max/').json()

    def test_nowy_rekord_zglaszany_po_zapisie_treningu(self):
        trening(self.c, self.ex, 60)  # 70 kg
        r = trening(self.c, self.ex, 75)  # 87,5 kg
        self.assertEqual(r.json()['new_records'][0]['previous'], 70.0)
        self.assertEqual(r.json()['new_records'][0]['current'], 87.5)

    def test_usuniecie_treningu_cofa_rekord(self):
        trening(self.c, self.ex, 60)
        sid = trening(self.c, self.ex, 75).json()['id']
        self.assertEqual(self.c.delete(f'/api/sessions/{sid}/').status_code, 204)
        self.assertEqual(self.rekord()[0]['value'], 70.0)

    def test_usuniecie_testu_cofa_rekord(self):
        trening(self.c, self.ex, 60)
        tid = self.c.post('/api/tests/', {'exercise': self.ex.id, 'protocol': '1rm', 'weight': 90, 'reps': 1},
                          format='json').json()['id']
        self.assertEqual(self.rekord()[0]['source'], 'test')
        self.c.delete(f'/api/tests/{tid}/')
        self.assertEqual(self.rekord()[0], {**self.rekord()[0], 'value': 70.0, 'source': 'estimate'})

    def test_trening_po_tescie_moze_podniesc_1rm(self):
        self.c.post('/api/tests/', {'exercise': self.ex.id, 'protocol': '1rm', 'weight': 80, 'reps': 1},
                    format='json')
        trening(self.c, self.ex, 75)  # 87,5 kg po teście
        self.assertEqual(self.rekord()[0]['value'], 87.5)
        self.assertEqual(self.rekord()[0]['source'], 'estimate')

    def test_wpis_reczny_trafia_do_historii_testow(self):
        self.assertEqual(self.c.post('/api/one-rep-max/', {'exercise': self.ex.id, 'value': 100},
                                     format='json').status_code, 201)
        self.assertEqual(self.c.get('/api/tests/').json()['results'][0]['protocol'], 'manual')
        self.assertEqual(self.rekord()[0]['source'], 'manual')

    def test_kalkulator_wzorow(self):
        r = self.c.get('/api/one-rep-max/?weight=100&reps=5').json()
        self.assertEqual(r['epley'], 116.7)
        self.assertEqual(r['brzycki'], 112.5)


class WF24_HistoriaTreninguTest(TestCase):
    def test_edycja_treningu_i_zapis_jako_plan(self):
        c, ex = klient('adam'), cwiczenie()
        sid = trening(c, ex, 80, duration_seconds=3600).json()['id']
        r = c.put(f'/api/sessions/{sid}/', {'notes': 'poprawione', 'sets': [
            {'exercise': ex.id, 'set_number': 1, 'weight': 85, 'reps': 5},
            {'exercise': ex.id, 'set_number': 2, 'weight': 85, 'reps': 4}]}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()['sets']), 2)
        plan = c.post(f'/api/sessions/{sid}/to-plan/', {'title': 'Mój trening'}, format='json').json()
        pos = plan['days'][0]['exercises'][0]
        self.assertEqual((pos['target_sets'], pos['target_reps'], pos['load_value']), (2, 5, 85.0))
        self.assertEqual(pos['calculated_weight'], 85.0)


class WF02_PreferencjePrzerwTest(TestCase):
    def test_zapis_i_walidacja_preferencji(self):
        c = klient('adam')
        r = c.put('/api/profile/', {'default_rest_seconds': 90, 'rest_step_seconds': 10,
                                    'rest_sound': False}, format='json').json()
        self.assertEqual((r['default_rest_seconds'], r['rest_step_seconds'], r['rest_sound']), (90, 10, False))
        self.assertEqual(c.put('/api/profile/', {'default_rest_seconds': 5}, format='json').status_code, 400)


class WF01_OdzyskiwanieHaslaTest(TestCase):
    def link(self):
        import re

        from django.core import mail
        return re.search(r'uid=([^&\s]+)&token=([^\s]+)', mail.outbox[-1].body).groups()

    def test_zmiana_hasla_przez_link_z_e_maila(self):
        from django.core import mail
        klient('adam')
        anonim = APIClient()
        r = anonim.post('/api/auth/password-reset/', {'email': 'ADAM@test.pl'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        uid, token = self.link()
        nowe = 'NoweHaslo456!'
        r = anonim.post('/api/auth/password-reset/confirm/',
                        {'uid': uid, 'token': token, 'password': nowe, 'password2': nowe}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(anonim.post('/api/auth/login/', {'username': 'adam', 'password': nowe},
                                     format='json').status_code, 200)
        # link działa jednorazowo
        r = anonim.post('/api/auth/password-reset/confirm/',
                        {'uid': uid, 'token': token, 'password': 'Inne789!x', 'password2': 'Inne789!x'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_nieznany_adres_nie_jest_ujawniany(self):
        from django.core import mail
        r = APIClient().post('/api/auth/password-reset/', {'email': 'nikt@test.pl'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_e_mail_wymagany_i_unikalny_przy_rejestracji(self):
        klient('adam')
        c = APIClient()
        r = c.post('/api/auth/register/', {'username': 'ewa', 'email': 'Adam@Test.pl',
                                           'password': HASLO, 'password2': HASLO}, format='json')
        self.assertEqual(r.status_code, 400)
        r = c.post('/api/auth/register/', {'username': 'ewa', 'password': HASLO, 'password2': HASLO}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_rownoczesna_rejestracja_tej_samej_nazwy_daje_400(self):
        from unittest import mock

        from django.db import IntegrityError

        from training.serializers import RegisterSerializer
        with mock.patch.object(RegisterSerializer, 'save', side_effect=IntegrityError('UNIQUE')):
            r = APIClient().post('/api/auth/register/', {'username': 'ola', 'email': 'ola@test.pl',
                                                         'password': HASLO, 'password2': HASLO}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('username', r.json())


class WF04_WidocznoscProfiluTest(TestCase):
    def setUp(self):
        self.adam, self.ewa, self.ex = klient('adam'), klient('ewa'), cwiczenie()
        trening(self.adam, self.ex, 100)

    def test_profil_domyslnie_prywatny(self):
        self.assertEqual(self.ewa.get('/api/users/adam/').status_code, 404)
        self.assertEqual(self.adam.get('/api/users/adam/').status_code, 200)  # własny zawsze widoczny

    def test_profil_publiczny_bez_treningow(self):
        self.adam.put('/api/profile/', {'profile_public': True}, format='json')
        r = self.ewa.get('/api/users/adam/').json()
        self.assertIsNone(r['trainings'])
        self.assertNotIn('health', str(r).lower())

    def test_profil_publiczny_z_treningami(self):
        self.adam.put('/api/profile/', {'profile_public': True, 'trainings_public': True}, format='json')
        self.assertEqual(self.ewa.get('/api/users/adam/').json()['trainings']['total_sessions'], 1)

    def test_treningi_nie_moga_byc_publiczne_przy_prywatnym_profilu(self):
        r = self.adam.put('/api/profile/', {'profile_public': False, 'trainings_public': True}, format='json')
        self.assertFalse(r.json()['trainings_public'])


class WF09_WlasnyPlanWKgTest(TestCase):
    def test_wlasny_plan_w_kg_nie_wymaga_kalibracji(self):
        c, ex = klient('adam'), cwiczenie()
        plan = c.post('/api/plans/', plan_payload(ex, 'kg', 80), format='json').json()
        pos = plan['days'][0]['exercises'][0]
        self.assertFalse(pos['needs_calibration'])
        self.assertEqual(pos['calculated_weight'], 80.0)


class ImportPlanuTest(TestCase):
    def test_komenda_importu_planu(self):

        klient('eksu')
        call_command('importuj_moj_plan', user='eksu', stdout=StringIO())
        plans = WorkoutPlan.objects.filter(creator__username='eksu').order_by('id')
        self.assertEqual([p.title for p in plans], ['Push', 'Pull', 'Upper', 'Lower'])
        self.assertTrue(all(p.days.count() == 1 and not p.is_public for p in plans))
        self.assertEqual(sum(p.exercises.count() for p in plans), 31)
        self.assertFalse(any(p.exercises.filter(needs_calibration=True).exists() for p in plans))

    def test_import_zaklada_konto_i_zapisuje_historie_bez_duplikatow(self):
        call_command('importuj_moj_plan', user='nowy', email='nowy@test.pl', haslo=HASLO, historia=True,
                     daty='2026-10-01,2026-10-02,2026-10-04,2026-10-05', stdout=StringIO())
        user = User.objects.get(username='nowy')
        self.assertEqual(user.email, 'nowy@test.pl')
        self.assertTrue(user.check_password(HASLO))
        self.assertEqual(WorkoutSession.objects.filter(user=user).count(), 4)
        self.assertEqual(ExerciseSet.objects.filter(session__user=user).count(), 97)   # 21 + 27 + 22 + 27 serii jak na zrzutach
        # ponowny import (--nadpisz) nie dubluje historii i podpina ją pod nowy plan
        call_command('importuj_moj_plan', user='nowy', nadpisz=True, historia=True,
                     daty='2026-10-01,2026-10-02,2026-10-04,2026-10-05', stdout=StringIO())
        self.assertEqual(WorkoutPlan.objects.filter(creator=user).count(), 4)
        for session in WorkoutSession.objects.filter(user=user):
            self.assertEqual(session.plan.title, session.plan_day.name)   # każdy trening pod swoim planem
        self.assertTrue(PersonalRecord.objects.filter(user=user).exists())

    def test_pulpit_rotuje_osobne_treningi(self):
        c = klient('eksu')
        call_command('importuj_moj_plan', user='eksu', historia=True,
                     daty='2026-10-01,2026-10-02,2026-10-04,2026-10-05', stdout=StringIO())
        plan = c.get('/api/dashboard/').json()['currentPlan']
        self.assertEqual(plan['nextDay']['name'], 'Push')     # najdawniej wykonany (Push, 1.10)
        self.assertIn('Push, Pull, Upper, Lower', plan['name'])
        push = WorkoutPlan.objects.get(creator__username='eksu', title='Push')
        c.post('/api/sessions/', {'plan': push.id, 'plan_day': push.days.first().id,
                                  'sets': [{'exercise': push.exercises.first().exercise_id, 'set_number': 1,
                                            'weight': 30, 'reps': 8}]}, format='json')
        plan = c.get('/api/dashboard/').json()['currentPlan']
        self.assertEqual(plan['nextDay']['name'], 'Pull')
        self.assertEqual(plan['completed'], 1)

    def test_import_ustawia_email_istniejacego_konta(self):
        klient('eksu')
        call_command('importuj_moj_plan', user='eksu', email='eksu@nowy.pl', stdout=StringIO())
        self.assertEqual(User.objects.get(username='eksu').email, 'eksu@nowy.pl')


class WF24_PowtorzeniaWZapasieTest(TestCase):
    """RIR - powtórzenia w zapasie do upadku mięśniowego."""

    def setUp(self):
        self.c, self.ex = klient('adam'), cwiczenie()

    def jeden_rm(self):
        return self.c.get('/api/one-rep-max/').json()[0]['value']

    def test_rir_i_rpe_uzupelniaja_sie(self):
        s = trening(self.c, self.ex, 100, rir=2).json()['sets'][0]
        self.assertEqual((s['rir'], s['rpe']), (2, 8.0))
        r = self.c.post('/api/sessions/', {'sets': [{'exercise': self.ex.id, 'set_number': 1, 'weight': 100,
                                                     'reps': 5, 'rpe': 9}]}, format='json').json()
        self.assertEqual(r['sets'][0]['rir'], 1)

    def test_rir_podnosi_szacowane_1rm(self):
        trening(self.c, self.ex, 60, rir=2)  # 60 x (1 + 7/30) = 74 kg
        self.assertEqual(self.jeden_rm(), 74.0)

    def test_serie_daleko_od_upadku_pomijane(self):
        trening(self.c, self.ex, 60, rir=6)
        self.assertEqual(self.c.get('/api/one-rep-max/').json(), [])

    def test_statystyka_bliskosci_upadku(self):
        for rir in (0, 0, 2, 6):
            trening(self.c, self.ex, 60, rir=rir)
        trening(self.c, self.ex, 60)  # seria bez oceny
        e = self.c.get('/api/stats/').json()['effort']
        self.assertEqual((e['total_sets'], e['rated_sets']), (5, 4))
        self.assertEqual(e['to_failure_percent'], 50.0)
        self.assertEqual(e['avg_rir'], 2.0)
        self.assertEqual({d['rir']: d['sets'] for d in e['distribution']}['5+'], 1)
        self.assertEqual(self.c.get('/api/reports/').json()['effort']['avg_rir'], 2.0)

    def test_walidacja_rir(self):
        self.assertEqual(trening(self.c, self.ex, 60, rir=11).status_code, 400)


def sesja(c, ex, serie, dni_temu=0, **extra):
    """serie: lista (ciężar, powtórzenia[, rir])"""
    sets = [{'exercise': ex.id, 'set_number': i + 1, 'weight': s[0], 'reps': s[1],
             **({'rir': s[2]} if len(s) > 2 else {})} for i, s in enumerate(serie)]
    return c.post('/api/sessions/', {'sets': sets, 'date_completed':
                  (timezone.now() - timedelta(days=dni_temu)).isoformat(), **extra}, format='json')


class WF08_PodwojnaProgresjaTest(TestCase):
    def setUp(self):
        self.c, self.ex = klient('adam'), cwiczenie()

    def sugestia(self, **q):
        qs = '&'.join(f'{k}={v}' for k, v in {'reps_min': 8, 'reps_max': 10, **q}.items())
        return self.c.get(f'/api/sessions/last-for-exercise/{self.ex.id}/?{qs}').json()['suggestion']

    def test_gorna_granica_we_wszystkich_seriach_zwieksza_ciezar(self):
        sesja(self.c, self.ex, [(80, 10), (80, 10), (80, 10)])
        s = self.sugestia()
        self.assertEqual((s['action'], s['weight']), ('increase', 82.5))

    def test_w_zakresie_utrzymaj_ciezar(self):
        sesja(self.c, self.ex, [(80, 10), (80, 9), (80, 8)])
        self.assertEqual(self.sugestia()['action'], 'keep')

    def test_zakres_osiagniety_ale_za_blisko_upadku(self):
        sesja(self.c, self.ex, [(80, 10, 0), (80, 10, 0)])
        s = self.sugestia(rir=2)
        self.assertEqual((s['action'], s['weight']), ('keep', 80))

    def test_dwa_treningi_ponizej_zakresu_odciazenie(self):
        sesja(self.c, self.ex, [(80, 6), (80, 6)], dni_temu=3)
        sesja(self.c, self.ex, [(80, 6), (80, 5)])
        s = self.sugestia()
        self.assertEqual((s['action'], s['weight']), ('decrease', 70.0))  # 80 × 0,9 = 72 -> w dół do 70

    def test_sugestie_dla_planu(self):
        plan = self.c.post('/api/plans/', {**plan_payload(self.ex, 'kg', 80), 'days': [{'name': 'A', 'exercises': [
            {'exercise': self.ex.id, 'target_sets': 3, 'target_reps': 8, 'target_reps_max': 10,
             'load_type': 'kg', 'load_value': 80}]}]}, format='json').json()
        pos = plan['days'][0]['exercises'][0]
        self.assertEqual(pos['target_reps_max'], 10)
        s = self.c.get(f"/api/plans/{plan['id']}/suggestions/").json()[str(pos['id'])]
        self.assertEqual((s['action'], s['weight']), ('start', 80.0))

    def test_walidacja_zakresu(self):
        r = self.c.post('/api/plans/', {**plan_payload(self.ex), 'days': [{'name': 'A', 'exercises': [
            {'exercise': self.ex.id, 'target_reps': 10, 'target_reps_max': 8}]}]}, format='json')
        self.assertEqual(r.status_code, 400)


class WF30_RekordyPowtorzenioweTest(TestCase):
    def test_rekord_na_liczbe_powtorzen(self):
        c, ex = klient('adam'), cwiczenie()
        sesja(c, ex, [(100, 5), (90, 8)], dni_temu=7)
        r = sesja(c, ex, [(102.5, 5), (90, 8), (95, 3)]).json()
        rekordy = {(x['reps'], x['weight']) for x in r['rep_records']}
        self.assertIn((5, 102.5), rekordy)
        self.assertNotIn((8, 90.0), rekordy)   # wyrównanie, nie rekord
        self.assertNotIn((3, 95.0), rekordy)   # 100 kg × 5 to także ≥3 powt.

    def test_pierwszy_trening_bez_rekordow(self):
        c, ex = klient('adam'), cwiczenie()
        self.assertEqual(sesja(c, ex, [(100, 5)]).json()['rep_records'], [])


class ObciazenieTreningoweTest(TestCase):
    def test_acwr_i_seria_tygodni(self):
        c, ex = klient('adam'), cwiczenie()
        for d in (1, 8, 15, 22):
            sesja(c, ex, [(100, 5)], dni_temu=d)
        load = c.get('/api/stats/').json()['load']
        self.assertEqual(load['acwr'], 1.0)
        self.assertEqual(load['zone'], 'optimal')
        self.assertGreaterEqual(load['streak_weeks'], 3)
        self.assertEqual(sum(d['sessions'] for d in load['calendar']), 4)

    def test_acwr_ukryty_przy_krotkiej_historii(self):
        c, ex = klient('adam'), cwiczenie()
        sesja(c, ex, [(100, 5)], dni_temu=1)
        load = c.get('/api/stats/').json()['load']
        self.assertIsNone(load['acwr'])
        self.assertIsNone(load['zone'])


class CeleSiloweTest(TestCase):
    def test_cel_z_postepem_i_prognoza(self):
        c, ex = klient('adam'), cwiczenie()
        for week, w in enumerate([80, 85, 90]):
            sesja(c, ex, [(w, 1)], dni_temu=(3 - week) * 7)
        goal = c.post('/api/goals/', {'exercise': ex.id, 'target_1rm': 100}, format='json').json()
        self.assertEqual(goal['start_1rm'], 90.0)
        self.assertEqual(goal['status']['progress_percent'], 0.0)
        self.assertIsNotNone(goal['status']['predicted_date'])
        sesja(c, ex, [(95, 1)])
        self.assertEqual(c.get('/api/goals/').json()[0]['status']['progress_percent'], 50.0)

    def test_cel_juz_osiagniety_odrzucony(self):
        c, ex = klient('adam'), cwiczenie()
        sesja(c, ex, [(100, 1)])
        self.assertEqual(c.post('/api/goals/', {'exercise': ex.id, 'target_1rm': 90}, format='json').status_code, 400)


class WF26_RealizacjaPlanuTest(TestCase):
    def test_porownanie_sesji_z_jednostka(self):
        c = klient('adam')
        a, b, extra = cwiczenie('A'), cwiczenie('B'), cwiczenie('C')
        plan = c.post('/api/plans/', {**plan_payload(a), 'days': [{'name': 'Dzień A', 'exercises': [
            {'exercise': a.id, 'target_sets': 3, 'target_reps': 5, 'load_type': 'kg', 'load_value': 100},
            {'exercise': b.id, 'target_sets': 2, 'target_reps': 8, 'load_type': 'kg', 'load_value': 50}]}]},
            format='json').json()
        sid = sesja(c, a, [(100, 5)] * 3, plan=plan['id'], plan_day=plan['days'][0]['id']).json()['id']
        s = WorkoutSession.objects.get(pk=sid)
        ExerciseSet.objects.create(session=s, exercise=extra, set_number=1, weight=20, reps=10)
        cmp = c.get(f'/api/sessions/{sid}/compare/').json()
        statusy = {i['exercise']: i['status'] for i in cmp['items']}
        self.assertEqual(statusy, {'A': 'done', 'B': 'skipped', 'C': 'added'})
        self.assertEqual(cmp['completion_percent'], 60.0)


class WF11_DuplikowanieINotatkiTest(TestCase):
    def test_duplikowanie_planu(self):
        c, ex = klient('adam'), cwiczenie()
        plan = c.post('/api/plans/', plan_payload(ex), format='json').json()
        kopia = c.post(f"/api/plans/{plan['id']}/duplicate/").json()
        self.assertEqual(kopia['title'], 'Plan siłowy (kopia)')
        self.assertFalse(kopia['is_public'])
        self.assertEqual(len(kopia['days'][0]['exercises']), 1)
        self.assertEqual(klient('obcy').post(f"/api/plans/{plan['id']}/duplicate/").status_code, 403)

    def test_notatka_do_cwiczenia(self):
        c, ex = klient('adam'), cwiczenie()
        c.put(f'/api/exercises/{ex.id}/note/', {'text': 'siedzisko na 4'}, format='json')
        self.assertEqual(c.get(f'/api/sessions/last-for-exercise/{ex.id}/').json()['note'], 'siedzisko na 4')
        self.assertEqual(klient('ewa').get(f'/api/exercises/{ex.id}/note/').json()['text'], '')
        c.put(f'/api/exercises/{ex.id}/note/', {'text': ''}, format='json')
        self.assertEqual(c.get(f'/api/exercises/{ex.id}/note/').json()['text'], '')


class ImportCSVTest(TestCase):
    STRONG = ('Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n'
              '2026-09-01 18:00:00,Push,1h 5m,Bench Press (Barbell),W,40,10,0,0,,,\n'
              '2026-09-01 18:00:00,Push,1h 5m,Bench Press (Barbell),1,80,8,0,0,,,8\n'
              '2026-09-01 18:00:00,Push,1h 5m,Deadlift (Barbell),1,140,5,0,0,,,\n'
              '2026-09-01 18:00:00,Push,1h 5m,Zottman Twist Special,1,12,10,0,0,,,\n'
              '2026-09-01 18:00:00,Push,1h 5m,Running,1,0,0,5,1800,,,\n'
              '2026-09-03 18:00:00,Pull,58m,Lat Pulldown (Cable),1,60,10,0,0,,,\n')
    HEVY = ('"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes",'
            '"set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"\n'
            '"Nogi","15 Sep 2026, 17:00","15 Sep 2026, 18:10","","Squat (Barbell)","","","0","normal","100","5","","","9"\n')
    TEMPLATE = 'date;exercise;weight;reps;rir\n2026-09-20;Leg Press;150;10;2\n'

    def importuj(self, c, tekst, nazwa='dane.csv'):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return c.post('/api/import/', {'file': SimpleUploadedFile(nazwa, tekst.encode('utf-8'))}, format='multipart')

    def test_import_strong_idempotentny(self):
        c = klient('adam')
        r = self.importuj(c, self.STRONG).json()
        self.assertEqual((r['format'], r['sessions_created'], r['sets_created'], r['rows_skipped']), ('strong', 2, 5, 1))
        self.assertEqual(r['exercises_created'], ['Zottman Twist Special'])
        s = WorkoutSession.objects.get(notes__startswith='Import: Push')
        self.assertEqual(s.duration_seconds, 3900)
        self.assertTrue(s.sets.get(weight=40).is_warmup)
        self.assertEqual(s.sets.get(weight=80).rir, 2)
        self.assertTrue(s.sets.filter(exercise__name__endswith='/ Deadlift').exists())
        again = self.importuj(c, self.STRONG).json()
        self.assertEqual((again['sessions_created'], again['sessions_skipped_duplicates']), (0, 2))
        self.assertEqual(c.get('/api/one-rep-max/').json()[0]['source'], 'estimate')

    def test_import_hevy_i_szablonu(self):
        c = klient('adam')
        h = self.importuj(c, self.HEVY).json()
        self.assertEqual((h['format'], h['sessions_created']), ('hevy', 1))
        self.assertEqual(WorkoutSession.objects.get().duration_seconds, 4200)
        t = self.importuj(c, self.TEMPLATE).json()
        self.assertEqual((t['format'], t['sets_created']), ('template', 1))

    def test_nieznany_format(self):
        r = self.importuj(klient('adam'), 'a,b,c\n1,2,3\n')
        self.assertEqual(r.status_code, 400)


class SzablonyIGeneratorTest(TestCase):
    def test_utworzenie_planu_z_szablonu(self):
        c = klient('adam')
        lista = c.get('/api/plan-templates/').json()
        self.assertEqual(len(lista['templates']), 5)
        r = c.post('/api/plan-templates/upper_lower/', {}, format='json').json()
        self.assertEqual(len(r['plan']['days']), 4)
        pos = r['plan']['days'][0]['exercises'][0]
        self.assertEqual((pos['load_type'], pos['target_reps'], pos['target_reps_max']), ('percent', 4, 6))
        self.assertTrue(pos['needs_calibration'])  # brak 1RM - % 1RM wymaga kalibracji

    def test_generator_dobiera_szablon_i_omija_ograniczenia(self):
        c = klient('adam')
        kolano = BodyArea.objects.get(code='kolano')
        c.put('/api/profile/', {'days_per_week': 3, 'goal': 'general', 'equipment': ['dumbbell', 'bodyweight'],
                                'health_consent': True, 'restrictions': [kolano.id]}, format='json')
        r = c.post('/api/plan-templates/auto/', {}, format='json').json()
        self.assertEqual(r['template'], 'home')
        self.assertTrue(r['changes'])
        plan = WorkoutPlan.objects.get(pk=r['plan']['id'])
        self.assertFalse(plan.exercises.filter(exercise__stressed_areas=kolano).exists())

    def test_generator_cel_sila(self):
        c = klient('adam')
        c.put('/api/profile/', {'goal': 'strength', 'equipment': ['barbell']}, format='json')
        self.assertEqual(c.post('/api/plan-templates/auto/', {}, format='json').json()['template'], 'strength_5x5')


class BazaCwiczenTest(TestCase):
    def test_uzupelnione_cwiczenia(self):
        for en in ['Deadlift', 'Chest press machine', 'Hack squat', 'Trap bar deadlift', 'Rear delt machine',
                   'Standing calf raise machine', 'Machine row', 'Seated leg curl']:
            self.assertTrue(Exercise.objects.filter(name__endswith=f' / {en}', created_by__isnull=True).exists(), en)

    def test_licznik_uzycia_cwiczen(self):
        c, ex = klient('adam'), cwiczenie()
        sesja(c, ex, [(50, 10), (50, 10)])
        lista = {e['id']: e['times_used'] for e in c.get('/api/exercises/').json()}
        self.assertEqual(lista[ex.id], 2)


class WF34_RozbudowanyRaportTest(TestCase):
    def test_porownanie_lista_treningow_i_rekordy(self):
        c, ex = klient('adam'), cwiczenie()
        bw = cwiczenie('Pompki testowe', sprzet='bodyweight')
        sesja(c, ex, [(80, 8)], dni_temu=40)                     # poprzedni okres
        sesja(c, ex, [(90, 8), (90, 7), (90, 6)], dni_temu=5)    # 90×8 obejmuje 90×7 i 90×6
        sesja(c, bw, [(0, 15)], dni_temu=4)
        r = c.get('/api/reports/').json()
        porownanie = {x['metric']: x for x in r['comparison']}
        self.assertEqual((porownanie['Treningi']['current'], porownanie['Treningi']['previous']), (2, 1))
        self.assertEqual(porownanie['Treningi']['change_percent'], 100.0)
        self.assertEqual(len(r['session_list']), 2)
        self.assertEqual([(x['reps'], x['weight']) for x in r['rep_records']], [(8, 90.0)])
        self.assertNotIn('Pompki testowe', [p['exercise'] for p in r['progress']])  # masa ciała - bez 1RM
        self.assertTrue(r['progress'][0]['record'])
        self.assertTrue(c.get('/api/reports/?export=pdf').content.startswith(b'%PDF'))


class WN07_BezpieczenstwoKontaTest(TestCase):
    def test_limit_prob_logowania(self):
        from unittest import mock

        from django.core.cache import cache
        from rest_framework.throttling import ScopedRateThrottle
        cache.clear()
        c = APIClient()
        with mock.patch.object(ScopedRateThrottle, 'THROTTLE_RATES', {'auth': '3/min'}):
            kody = [c.post('/api/auth/login/', {'username': 'x', 'password': 'y'}, format='json').status_code
                    for _ in range(4)]
        self.assertEqual(kody, [401, 401, 401, 429])

    def test_zmiana_hasla(self):
        c = klient('adam')
        self.assertEqual(c.post('/api/auth/password/', {'old_password': 'zle', 'new_password': 'NoweHaslo456!',
                                                        'new_password2': 'NoweHaslo456!'}, format='json').status_code, 400)
        self.assertEqual(c.post('/api/auth/password/', {'old_password': HASLO, 'new_password': '123',
                                                        'new_password2': '123'}, format='json').status_code, 400)
        r = c.post('/api/auth/password/', {'old_password': HASLO, 'new_password': 'NoweHaslo456!',
                                           'new_password2': 'NoweHaslo456!'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(c.get('/api/auth/me/').status_code, 200)  # sesja pozostaje aktywna
        self.assertTrue(User.objects.get(username='adam').check_password('NoweHaslo456!'))


class WalidacjaDanychTest(TestCase):
    """Zakresy wartości wprowadzanych przez użytkownika (walidator in_range w serializerach)."""

    def setUp(self):
        self.c = klient('walidacja')
        self.ex = cwiczenie()

    def test_seria_poza_zakresem(self):
        for blad in ({'ciezar': 1500}, {'ciezar': 80, 'powt': 0}, {'ciezar': 80, 'rir': 11}):
            r = trening(self.c, self.ex, blad['ciezar'], powt=blad.get('powt', 5), rir=blad.get('rir'))
            self.assertEqual(r.status_code, 400, blad)
        self.assertEqual(trening(self.c, self.ex, 80, rir=2).status_code, 201)

    def test_sesja_i_profil_poza_zakresem(self):
        self.assertEqual(trening(self.c, self.ex, 80, post_workout_hr=300).status_code, 400)
        self.assertEqual(trening(self.c, self.ex, 80, duration_seconds=7 * 3600).status_code, 400)
        self.assertEqual(self.c.patch('/api/profile/', {'days_per_week': 9}, format='json').status_code, 400)
        self.assertEqual(self.c.patch('/api/profile/', {'default_rest_seconds': 5}, format='json').status_code, 400)


class ZgloszeniaTresciTest(TestCase):
    def test_zgloszenie_planu_i_komentarza(self):
        a, k = klient('autor2'), klient('czytelnik')
        plan_id = a.post('/api/plans/', plan_payload(cwiczenie()), format='json').json()['id']
        self.assertEqual(k.post(f'/api/plans/{plan_id}/flag/', {'reason': ''}, format='json').status_code, 400)
        self.assertEqual(k.post(f'/api/plans/{plan_id}/flag/', {'reason': 'Spam'}, format='json').status_code, 201)
        com = k.post(f'/api/plans/{plan_id}/comments/', {'text': 'Pytanie'}, format='json').json()['id']
        self.assertEqual(a.post(f'/api/comments/{com}/flag/', {'reason': 'Obraźliwy'}, format='json').status_code, 201)
        self.assertEqual(a.post('/api/comments/99999/flag/', {'reason': 'x'}, format='json').status_code, 404)
        self.assertEqual(ContentReport.objects.count(), 2)


class WF22_ModeracjaTest(TestCase):
    def setUp(self):
        self.autor, self.zglaszajacy = klient('autor3'), klient('zglaszajacy')
        self.mod = klient('moderator')
        User.objects.filter(username='moderator').update(is_staff=True)
        self.plan_id = self.autor.post('/api/plans/', plan_payload(cwiczenie()), format='json').json()['id']

    def zglos(self, c, powod='Spam'):
        return c.post(f'/api/plans/{self.plan_id}/flag/', {'reason': powod}, format='json')

    def test_dostep_tylko_dla_moderatora(self):
        self.assertEqual(self.autor.get('/api/moderation/reports/').status_code, 403)
        self.assertEqual(self.mod.get('/api/moderation/reports/').status_code, 200)

    def test_ukrycie_zamyka_wszystkie_zgloszenia_i_powiadamia(self):
        drugi = klient('drugi')
        self.zglos(self.zglaszajacy)
        self.zglos(drugi, 'Reklama')
        self.assertEqual(self.zglos(self.zglaszajacy).status_code, 200)  # ponowne zgłoszenie - bez duplikatu
        lista = self.mod.get('/api/moderation/reports/').json()
        self.assertEqual(lista['open_count'], 1)
        self.assertEqual(lista['reports'][0]['reports_count'], 2)
        r = self.mod.post(f"/api/moderation/reports/{lista['reports'][0]['id']}/decision/",
                          {'decision': 'hidden', 'note': 'Reklama'}, format='json')
        self.assertEqual(r.json()['closed_reports'], 2)
        self.assertTrue(WorkoutPlan.objects.get(pk=self.plan_id).is_hidden)
        self.assertEqual(drugi.get(f'/api/plans/{self.plan_id}/').status_code, 404)
        self.assertEqual(self.mod.get(f'/api/plans/{self.plan_id}/').status_code, 200)  # moderator nadal widzi
        self.assertEqual(self.autor.get(f'/api/plans/{self.plan_id}/').json()['is_hidden'], True)
        self.assertTrue(Notification.objects.filter(user__username='autor3', text__contains='ukrył').exists())
        self.assertEqual(Notification.objects.filter(text__contains='Rozpatrzono').count(), 2)
        # przywrócenie
        zamkniete = self.mod.get('/api/moderation/reports/?status=closed').json()['reports']
        self.mod.post(f"/api/moderation/reports/{zamkniete[0]['id']}/decision/", {'decision': 'restored'}, format='json')
        self.assertFalse(WorkoutPlan.objects.get(pk=self.plan_id).is_hidden)

    def test_odrzucenie_i_wlasna_tresc(self):
        self.assertEqual(self.zglos(self.autor).status_code, 400)
        self.zglos(self.zglaszajacy)
        rid = ContentReport.objects.get().id
        self.mod.post(f'/api/moderation/reports/{rid}/decision/', {'decision': 'dismissed'}, format='json')
        self.assertFalse(WorkoutPlan.objects.get(pk=self.plan_id).is_hidden)
        self.assertEqual(self.mod.get('/api/moderation/reports/').json()['open_count'], 0)

    def test_blokada_konta(self):
        autor = User.objects.get(username='autor3')
        self.assertEqual(self.mod.post(f'/api/moderation/users/{autor.id}/block/', {'blocked': True},
                                       format='json').status_code, 200)
        self.assertIsNone(self.autor.get('/api/auth/me/').json())  # sesja zablokowanego konta wygasa
        self.assertTrue(WorkoutPlan.objects.get(pk=self.plan_id).is_hidden)
        c = APIClient()
        r = c.post('/api/auth/login/', {'username': 'autor3', 'password': HASLO}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertIn('zablokowane', r.json()['detail'])
        moderator = User.objects.get(username='moderator')
        self.assertEqual(self.mod.post(f'/api/moderation/users/{moderator.id}/block/', {}, format='json').status_code, 400)


class WN01_LiczbaZapytanTest(TestCase):
    """Liczba zapytań do bazy nie rośnie z liczbą ćwiczeń w planie ani z długością historii."""

    def zapytania(self, c, url):
        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(c.get(url).status_code, 200)
        return len(ctx.captured_queries)

    def przygotuj(self, login, n_cwiczen):
        c = klient(login)
        user = User.objects.get(username=login)
        exs = [cwiczenie(f'{login} ćw. {i}') for i in range(n_cwiczen)]
        payload = plan_payload(exs[0])
        payload['days'][0]['exercises'] = [
            {'exercise': ex.id, 'target_sets': 3, 'target_reps': 5, 'load_type': 'kg', 'load_value': 50,
             'rest_seconds': 120} for ex in exs]
        plan_id = c.post('/api/plans/', payload, format='json').json()['id']
        for d in range(8):
            s = WorkoutSession.objects.create(user=user, date_completed=timezone.now() - timedelta(days=d * 3))
            ExerciseSet.objects.bulk_create([ExerciseSet(session=s, exercise=ex, set_number=1, weight=50, reps=5)
                                             for ex in exs])
        return c, plan_id

    def test_stala_liczba_zapytan(self):
        maly, plan_maly = self.przygotuj('maly', 2)
        duzy, plan_duzy = self.przygotuj('duzy', 10)
        for url in ('/api/plans/{}/', '/api/plans/{}/suggestions/', '/api/stats/', '/api/reports/', '/api/dashboard/'):
            a = self.zapytania(maly, url.format(plan_maly))
            b = self.zapytania(duzy, url.format(plan_duzy))
            self.assertLessEqual(b, a + 1, f'{url}: {a} zapytań przy 2 ćwiczeniach, {b} przy 10')


class DokumentacjaApiTest(TestCase):
    def test_schemat_openapi(self):
        r = APIClient().get('/api/schema/', {'format': 'json'})
        self.assertEqual(r.status_code, 200)
        paths = r.json()['paths']
        for path in ('/api/sessions/', '/api/plans/{id}/fork/', '/api/moderation/reports/', '/api/reports/'):
            self.assertIn(path, paths)


class PoleceniaIWidokiSystemoweTest(TestCase):
    def test_nadaj_moderatora(self):
        klient('jan')
        call_command('nadaj_moderatora', 'jan', stdout=StringIO())
        self.assertTrue(User.objects.get(username='jan').is_staff)
        call_command('nadaj_moderatora', 'jan', '--odbierz', stdout=StringIO())
        self.assertFalse(User.objects.get(username='jan').is_staff)
        with self.assertRaises(CommandError):
            call_command('nadaj_moderatora', 'nieistniejacy', stdout=StringIO())

    def test_import_csv_z_pliku(self):
        klient('jan')
        cwiczenie('Back squat')
        with tempfile.NamedTemporaryFile('w', suffix='.csv', delete=False, encoding='utf-8') as f:
            f.write('date,exercise,weight,reps\n2026-09-01,Back squat,100,5\n2026-09-01,Back squat,100,5\n')
        out = StringIO()
        call_command('importuj_csv', user='jan', plik=f.name, stdout=out)
        self.assertEqual(WorkoutSession.objects.filter(user__username='jan').count(), 1)
        self.assertIn('Zaimportowano', out.getvalue())

    def test_kontrola_stanu_i_pliki_pwa(self):
        c = APIClient()
        r = c.get('/api/health/')
        self.assertEqual((r.status_code, r.json()['status']), (200, 'ok'))
        self.assertIn('Content-Security-Policy', r.headers)
        self.assertIn(c.get('/sw.js').status_code, (200, 404))  # 404, gdy frontend nie jest zbudowany
        self.assertEqual(c.get('/trening').status_code, 200)    # aplikacja React dla każdej ścieżki


class WF26_ZamianaCwiczeniaTest(TestCase):
    def test_zamienniki_bez_ograniczen_zdrowotnych(self):
        c = klient('jan')
        glowne = cwiczenie('Wyciskanie testowe', grupa='Klatka', obszary=['bark'])
        cwiczenie('Rozpiętki testowe', grupa='Klatka', sprzet='dumbbell')
        cwiczenie('Pompki testowe', grupa='Klatka', sprzet='bodyweight', obszary=['bark'])
        cwiczenie('Przysiad inny', grupa='Nogi')
        nazwy = [e['name'] for e in c.get(f'/api/exercises/{glowne.id}/substitutes/').json()]
        self.assertIn('Rozpiętki testowe', nazwy)
        self.assertNotIn('Przysiad inny', nazwy)
        # ograniczenie barku w ankiecie wyklucza ćwiczenia obciążające bark
        bark = BodyArea.objects.get(code='bark')
        c.put('/api/profile/', {'health_consent': True, 'restrictions': [bark.id]}, format='json')
        nazwy = [e['name'] for e in c.get(f'/api/exercises/{glowne.id}/substitutes/').json()]
        self.assertNotIn('Pompki testowe', nazwy)


class WN10_AnkietaSusTest(TestCase):
    def test_wynik_i_zestawienie(self):
        from training.models import SusResponse
        self.assertEqual(SusResponse.compute_score([5, 1] * 5), 100.0)
        self.assertEqual(SusResponse.compute_score([3] * 10), 50.0)
        a, b = klient('tester1'), klient('tester2')
        self.assertEqual(a.post('/api/sus/', {'answers': [4, 2] * 5}, format='json').json()['score'], 75.0)
        self.assertEqual(a.post('/api/sus/', {'answers': [5, 1] * 5}, format='json').status_code, 201)  # poprawa
        b.post('/api/sus/', {'answers': [4, 2, 4, 2, 4, 2, 4, 2, 3, 3], 'comment': 'OK'}, format='json')
        self.assertEqual(a.post('/api/sus/', {'answers': [6] * 10}, format='json').status_code, 400)
        self.assertEqual(a.post('/api/sus/', {'answers': [3] * 9}, format='json').status_code, 400)
        self.assertEqual(a.get('/api/sus/summary/').status_code, 403)
        User.objects.filter(username='tester1').update(is_staff=True)
        s = a.get('/api/sus/summary/').json()
        self.assertEqual((s['count'], s['mean'], s['target_met']), (2, 85.0, True))
        self.assertEqual(len(s['per_question']), 10)


class WF46_AsystentPlanuTest(TestCase):
    def setUp(self):
        self.c = klient('asystent')
        self.bench = cwiczenie('Wyciskanie / Barbell bench press', grupa='Klatka piersiowa', obszary=['bark'])
        self.db = cwiczenie('Wyciskanie hantli / Dumbbells bench press', grupa='Klatka piersiowa', sprzet='dumbbell')
        self.machine = cwiczenie('Maszyna / Chest press machine', grupa='Klatka piersiowa', sprzet='machine')
        cwiczenie('Guma / Band chest press', grupa='Klatka piersiowa', sprzet='band')

    def miejsce(self, split='push_pull_legs', dzien=0, etykieta='Wyciskanie na klatkę'):
        r = self.c.post('/api/plan-assistant/', {'split': split}, format='json').json()
        return next(s for s in r['days'][dzien]['slots'] if s['label'] == etykieta)

    def nazwy(self, slot):
        return [c['name'] for c in slot['candidates']]

    def test_lista_podzialow_i_polecany(self):
        r = self.c.get('/api/plan-assistant/').json()
        self.assertEqual({s['key'] for s in r['splits']}, {'full_body', 'upper_lower', 'push_pull_legs', 'push_pull'})
        self.assertEqual(r['recommended'], 'full_body')  # domyślnie 3 dni w tygodniu
        self.assertEqual(self.c.post('/api/plan-assistant/', {'split': 'xyz'}, format='json').status_code, 400)

    def test_propozycje_podstawowe_bez_gum(self):
        slot = self.miejsce()
        self.assertEqual(slot['candidates'][0]['id'], self.bench.id)  # wariant podstawowy na początku
        self.assertNotIn('Guma / Band chest press', self.nazwy(slot))
        self.assertEqual(slot['default'], self.bench.id)

    def test_ograniczenia_zdrowotne_wykluczaja(self):
        bark = BodyArea.objects.get(code='bark')
        self.c.put('/api/profile/', {'health_consent': True, 'restrictions': [bark.id]}, format='json')
        slot = self.miejsce()
        self.assertNotIn(self.bench.name, self.nazwy(slot))
        self.assertEqual(slot['default'], self.db.id)

    def test_historia_i_sprzet_wplywaja_na_kolejnosc(self):
        for _ in range(3):
            trening(self.c, self.machine, 60)
        slot = self.miejsce()
        self.assertEqual(slot['candidates'][0]['id'], self.machine.id)
        self.assertIn('wykonywane 3×', slot['candidates'][0]['tags'])
        self.c.put('/api/profile/', {'equipment': ['dumbbell']}, format='json')
        slot = self.miejsce()
        self.assertEqual(slot['candidates'][0]['id'], self.db.id)          # dostępny sprzęt pierwszy
        self.assertIn('sprzęt spoza profilu', slot['candidates'][-1]['tags'])

    def test_rozne_warianty_w_kolejnych_jednostkach(self):
        a = self.miejsce('upper_lower', 0)
        b = self.c.post('/api/plan-assistant/', {'split': 'upper_lower'}, format='json').json()['days'][2]
        self.assertNotIn('Wyciskanie na klatkę', [s['label'] for s in b['slots']])  # Góra B ma wyciskanie skośne
        self.assertTrue(a['candidates'])


class ZapisSeriiTest(TestCase):
    def test_profil_przyjmuje_klasyczny_zapis_serii(self):
        c = klient('adam')
        r = c.put('/api/profile/', {'effort_scale': 'reps'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(c.get('/api/profile/').json()['effort_scale'], 'reps')
        self.assertEqual(c.put('/api/profile/', {'effort_scale': 'xyz'}, format='json').status_code, 400)


class HostingTest(TestCase):
    """Działanie za hostingiem w chmurze: kontrole stanu i długie sesje na telefonie."""

    def test_ping_nie_pyta_bazy_i_dziala_dla_dowolnego_hosta(self):
        c = APIClient(HTTP_HOST='10.0.0.7:10000')     # wewnętrzny adres kontenera, spoza ALLOWED_HOSTS
        with CaptureQueriesContext(connection) as q:
            r = c.get('/api/ping/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(q.captured_queries), 0)
        self.assertEqual(c.get('/api/health/').json()['database'], True)
        with self.assertLogs('django.security.DisallowedHost', level='ERROR'):
            self.assertEqual(c.get('/api/plans/').status_code, 400)  # reszta aplikacji nadal sprawdza Host

    def test_sesja_przedluzana_raz_na_dobe(self):
        from django.conf import settings
        self.assertGreaterEqual(settings.SESSION_COOKIE_AGE, 90 * 24 * 3600)
        c = klient('adam')
        r = c.get('/api/auth/me/')
        self.assertIn(settings.SESSION_COOKIE_NAME, r.cookies)       # pierwsze użycie danego dnia
        r = c.get('/api/auth/me/')
        self.assertNotIn(settings.SESSION_COOKIE_NAME, r.cookies)    # kolejne - bez zapisu sesji


class PrzeniesieniePrzezChmureTest(TestCase):
    """Komenda przenies_do_chmury: kopia danych z bazy lokalnej do bazy w chmurze."""

    def wywolaj(self, users_in_target, **opts):
        import json
        from types import SimpleNamespace
        from unittest import mock
        calls, fixture = [], {}

        def fake_run(cmd, **kwargs):
            calls.append(cmd[2])
            self.assertEqual(kwargs['env']['DATABASE_URL'], 'postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require')
            if cmd[2] == 'shell':
                return SimpleNamespace(returncode=0, stdout=f'{users_in_target}\n', stderr='')
            if cmd[2] == 'loaddata':
                with open(cmd[3], encoding='utf-8') as f:
                    fixture['data'] = json.load(f)
                return SimpleNamespace(returncode=0, stdout='Installed 5 object(s) from 1 fixture(s)\n', stderr='')
            return SimpleNamespace(returncode=0, stdout='', stderr='')

        out = StringIO()
        with mock.patch('training.management.commands.przenies_do_chmury.subprocess.run', side_effect=fake_run):
            call_command('przenies_do_chmury', cel='postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=require',
                         stdout=out, **opts)
        return calls, fixture.get('data'), out.getvalue()

    def test_kopiuje_dane_w_utf8_do_pustej_bazy(self):
        User.objects.create_user('łucja', 'lucja@test.pl', HASLO)   # polskie znaki w kopii
        calls, data, out = self.wywolaj(0)
        self.assertEqual(calls, ['migrate', 'shell', 'loaddata'])
        self.assertIn('łucja', [o['fields'].get('username') for o in data if o['model'] == 'auth.user'])
        self.assertFalse(any(o['model'] in ('contenttypes.contenttype', 'sessions.session') for o in data))
        self.assertIn('Gotowe', out)

    def test_odmawia_gdy_w_bazie_sa_konta(self):
        with self.assertRaisesMessage(CommandError, 'są już konta'):
            self.wywolaj(3)

    def test_zly_adres(self):
        with self.assertRaisesMessage(CommandError, 'postgresql://'):
            call_command('przenies_do_chmury', cel='mysql://x', stdout=StringIO())


class PlikiStatyczneTest(TestCase):
    """Pliki, do których odwołuje się strona, muszą istnieć w repozytorium (inaczej wdrożenie się sypie)."""

    def test_pliki_z_szablonu_i_manifestu_pwa_sa_w_repozytorium(self):
        import json
        import re
        from pathlib import Path

        from django.conf import settings
        public = Path(settings.BASE_DIR).parent / 'frontend' / 'public'
        template = (Path(settings.BASE_DIR) / 'training' / 'templates' / 'training' / 'react_app.html').read_text(encoding='utf-8')
        used = re.findall(r"\{% static 'dist/([^']+\.[a-z0-9]+)' %\}", template)
        manifest = json.loads((public / 'manifest.webmanifest').read_text(encoding='utf-8'))
        icons = [i['src'] for i in manifest['icons']] + [i['src'] for s in manifest.get('shortcuts', []) for i in s.get('icons', [])]
        used += [src.removeprefix('/static/dist/') for src in icons]
        self.assertIn('icons/favicon-32.png', used)
        missing = [f for f in set(used) if not (public / f).is_file()]
        self.assertEqual(missing, [], f'Brak plików w frontend/public: {missing}')

    def test_brak_pliku_w_manifescie_nie_wywraca_strony(self):
        import tempfile

        from core.storage import StaticStorage
        with tempfile.TemporaryDirectory() as tmp:
            storage = StaticStorage(location=tmp, base_url='/static/')
            with self.assertLogs('core.storage', level='WARNING'):
                self.assertEqual(storage.url('dist/icons/nie-ma.png'), '/static/dist/icons/nie-ma.png')

    def test_robots_i_favicon(self):
        c = APIClient()
        r = c.get('/robots.txt')
        self.assertEqual((r.status_code, r['Content-Type']), (200, 'text/plain'))
        self.assertIn('Disallow: /api/', r.content.decode())
        r = c.get('/favicon.ico')
        self.assertEqual(r.status_code, 301)
        self.assertTrue(r['Location'].endswith('icons/favicon-32.png'))
