from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    # Django admin panel — login at /admin/
    path('admin/', admin.site.urls),

    # Authentication endpoints:
    # POST /api/auth/register/         → create account
    # POST /api/auth/login/            → get JWT token
    # POST /api/auth/token/refresh/    → refresh expired token
    # GET/PUT /api/auth/profile/       → read/update user profile
    path('api/auth/', include('accounts.urls')),

    # Project endpoints:
    # GET/POST /api/projects/          → list or create
    # GET/PUT/DELETE /api/projects/<uuid>/ → single project
    path('api/projects/', include('projects.urls')),

    # Dataset upload endpoint:
    # POST /api/projects/<uuid>/datasets/upload/
    # The <uuid:project_id> is captured here and passed to the dataset view
    path('api/projects/<uuid:project_id>/datasets/', include('datasets.upload_urls')),

    # Dataset version history endpoints:
    # GET  /api/projects/<uuid:project_id>/versions/
    # GET  /api/projects/<uuid:project_id>/versions/for-step/<step_name>/
    # POST /api/projects/<uuid:project_id>/versions/register/
    # DEL  /api/projects/<uuid:project_id>/versions/cascade/<step_name>/
    # GET  /api/projects/<uuid:project_id>/versions/<uuid:version_id>/download/
    path('api/projects/<uuid:project_id>/', include('datasets.version_urls')),

    # Dataset detail endpoint:
    # GET /api/datasets/<uuid>/
    path('api/datasets/', include('datasets.urls')),

    # PRISM Auto Mode audit trail (backend-fastapi/auto_mode/ writes here
    # via django_client.py — the LangGraph pipeline's own pause/resume
    # state lives in a local SQLite checkpoint file inside backend-fastapi,
    # never in this Postgres database; this is the durable, user-facing
    # record of what the agent did and why):
    # POST      /api/projects/<uuid:project_id>/automode/run/
    # GET/PATCH /api/projects/<uuid:project_id>/automode/run/<uuid>/
    # POST      /api/projects/<uuid:project_id>/automode/run/<uuid>/decisions/
    # PATCH     /api/projects/<uuid:project_id>/automode/run/<uuid>/decisions/<uuid>/
    path('api/projects/<uuid:project_id>/automode/', include('experiments.urls')),

] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
# The static() line serves uploaded files during development.
# In production you would serve these through Nginx, not Django.
