from django.urls import path
from .version_views import (
    VersionListView,
    VersionForStepView,
    VersionRegisterView,
    VersionCascadeView,
    VersionDownloadView,
)

# Mounted under /api/projects/<uuid:project_id>/ in core/urls.py, alongside
# (not overlapping with) upload_urls.py's .../datasets/upload/ route.
urlpatterns = [
    path('versions/', VersionListView.as_view(), name='version-list'),
    path('versions/for-step/<str:step_name>/', VersionForStepView.as_view(), name='version-for-step'),
    path('versions/register/', VersionRegisterView.as_view(), name='version-register'),
    path('versions/cascade/<str:step_name>/', VersionCascadeView.as_view(), name='version-cascade'),
    path('versions/<uuid:version_id>/download/', VersionDownloadView.as_view(), name='version-download'),
]
