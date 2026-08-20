from django.urls import path
from .views import DatasetUploadView

# Mounted only under /api/projects/<uuid:project_id>/datasets/ in core/urls.py,
# so DatasetUploadView always receives project_id. Kept in its own file (instead
# of sharing datasets/urls.py) so this prefix never also exposes the
# dataset-detail route, which does not accept a project_id argument.
urlpatterns = [
    # POST /api/projects/<uuid:project_id>/datasets/upload/
    path('upload/', DatasetUploadView.as_view(), name='dataset-upload'),
]
