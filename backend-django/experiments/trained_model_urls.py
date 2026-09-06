from django.urls import path
from .trained_model_views import TrainedModelListCreateView, TrainedModelDetailView

urlpatterns = [
    # GET/POST /api/projects/<uuid:project_id>/trained-models/
    path('', TrainedModelListCreateView.as_view(), name='trained-model-list-create'),

    # DELETE /api/projects/<uuid:project_id>/trained-models/<uuid:model_pk>/
    path('<uuid:model_pk>/', TrainedModelDetailView.as_view(), name='trained-model-detail'),
]
