from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.utils.csp import CSP
from django.views.decorators.csp import csp_override
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter

from training import views

router = DefaultRouter()
router.register(r'sessions', views.WorkoutSessionViewSet, basename='session')
router.register(r'plans', views.WorkoutPlanViewSet, basename='plan')
router.register(r'exercises', views.ExerciseViewSet, basename='exercise')
router.register(r'measurements', views.BodyMeasurementViewSet, basename='measurement')
router.register(r'tests', views.StrengthTestViewSet, basename='strength-test')
router.register(r'notifications', views.NotificationViewSet, basename='notification')
router.register(r'goals', views.TrainingGoalViewSet, basename='goal')

urlpatterns = [
    path('admin/', admin.site.urls),

    # konto
    path('api/auth/csrf/', views.CSRFTokenAPIView.as_view(), name='auth_csrf'),
    path('api/auth/register/', views.RegisterAPIView.as_view(), name='auth_register'),
    path('api/auth/login/', views.LoginAPIView.as_view(), name='auth_login'),
    path('api/auth/logout/', views.LogoutAPIView.as_view(), name='auth_logout'),
    path('api/auth/me/', views.MeAPIView.as_view(), name='auth_me'),
    path('api/auth/export/', views.ExportAPIView.as_view(), name='auth_export'),
    path('api/auth/password/', views.PasswordChangeAPIView.as_view(), name='password_change'),
    path('api/auth/password-reset/', views.PasswordResetRequestAPIView.as_view(), name='password_reset'),
    path('api/auth/password-reset/confirm/', views.PasswordResetConfirmAPIView.as_view(),
         name='password_reset_confirm'),
    path('api/users/<str:username>/', views.PublicProfileAPIView.as_view(), name='public_profile'),
    path('api/users/<str:username>/follow/', views.FollowAPIView.as_view(), name='follow'),
    path('api/users/<str:username>/workouts/', views.UserWorkoutsAPIView.as_view(), name='user_workouts'),
    path('api/feed/', views.FeedAPIView.as_view(), name='feed'),
    path('api/people/', views.PeopleAPIView.as_view(), name='people'),
    path('api/sessions/<int:pk>/kudos/', views.KudosAPIView.as_view(), name='kudos'),
    path('api/profile/', views.ProfileAPIView.as_view(), name='profile'),
    path('api/profile/avatar/', views.AvatarAPIView.as_view(), name='profile_avatar'),
    path('api/avatars/<int:user_id>/', views.avatar_image, name='avatar_image'),
    path('api/meta/', views.MetaAPIView.as_view(), name='meta'),

    # dokumentacja API (OpenAPI); strona Swagger UI zawiera skrypt inline, stąd łagodniejsza polityka CSP
    path('api/schema/', SpectacularAPIView.as_view(), name='api_schema'),
    path('api/docs/', csp_override({**settings.SECURE_CSP, 'script-src': [CSP.SELF, CSP.UNSAFE_INLINE]})(
        SpectacularSwaggerView.as_view(url_name='api_schema')), name='api_docs'),

    # dane
    path('api/health/', views.health, name='health'),
    path('api/', include(router.urls)),
    path('api/one-rep-max/', views.OneRepMaxAPIView.as_view(), name='one_rep_max'),
    path('api/comments/<int:pk>/flag/', views.FlagCommentAPIView.as_view(), name='comment_flag'),
    path('api/dashboard/', views.DashboardAPIView.as_view(), name='dashboard_api'),
    path('api/stats/', views.StatsAPIView.as_view(), name='stats_api'),
    path('api/reports/', views.ReportAPIView.as_view(), name='reports_api'),
    path('api/import/', views.ImportAPIView.as_view(), name='import_csv'),
    path('api/plan-assistant/', views.PlanAssistantAPIView.as_view(), name='plan_assistant'),
    path('api/plan-templates/', views.PlanTemplatesAPIView.as_view(http_method_names=['get']),
         name='plan_templates'),
    path('api/plan-templates/<str:key>/', views.PlanTemplatesAPIView.as_view(http_method_names=['post']),
         name='plan_template_create'),

    # ankieta użyteczności SUS (WN-10)
    path('api/sus/', views.SusAPIView.as_view(), name='sus'),
    path('api/sus/summary/', views.SusSummaryAPIView.as_view(), name='sus_summary'),

    # moderacja (konta personelu)
    path('api/moderation/reports/', views.ModerationReportsAPIView.as_view(), name='moderation_reports'),
    path('api/moderation/reports/<int:pk>/decision/', views.ModerationDecisionAPIView.as_view(),
         name='moderation_decision'),
    path('api/moderation/users/<int:pk>/block/', views.ModerationUserBlockAPIView.as_view(),
         name='moderation_block'),

    # PWA - service worker musi być serwowany z katalogu głównego
    path('sw.js', views.service_worker, name='service_worker'),
    path('manifest.webmanifest', views.web_manifest, name='web_manifest'),
    path('robots.txt', views.robots_txt, name='robots_txt'),
    path('favicon.ico', views.favicon, name='favicon'),

    # React SPA - wszystkie pozostałe adresy obsługuje router po stronie przeglądarki
    re_path(r'^(?!api/|admin/|static/).*$', views.SPAView.as_view(), name='spa'),
]
