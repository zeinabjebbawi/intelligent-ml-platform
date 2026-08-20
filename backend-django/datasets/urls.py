from django.urls import path
from .views import DatasetDetailView

# Mounted only under /api/datasets/ in core/urls.py — see upload_urls.py for
# the upload route, which lives under /api/projects/<uuid>/datasets/ instead.
urlpatterns = [
    # GET /api/datasets/<uuid>/
    path('<uuid:dataset_id>/', DatasetDetailView.as_view(), name='dataset-detail'),
]
