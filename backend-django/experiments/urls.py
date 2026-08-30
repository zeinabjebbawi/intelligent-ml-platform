from django.urls import path
from .views import (
    AutoModeStartView, AutoModeRunDetailView, AutoModeDecisionLogView, AutoModeDecisionResolveView,
)

urlpatterns = [
    # POST /api/projects/<uuid:project_id>/automode/run/ → start a run
    path('run/', AutoModeStartView.as_view(), name='automode-start'),

    # GET/PATCH /api/projects/<uuid:project_id>/automode/run/<uuid:experiment_id>/
    path('run/<uuid:experiment_id>/', AutoModeRunDetailView.as_view(), name='automode-run-detail'),

    # POST /api/projects/<uuid:project_id>/automode/run/<uuid:experiment_id>/decisions/
    path('run/<uuid:experiment_id>/decisions/', AutoModeDecisionLogView.as_view(), name='automode-decision-log'),

    # PATCH /api/projects/<uuid:project_id>/automode/run/<uuid:experiment_id>/decisions/<uuid:decision_id>/
    path('run/<uuid:experiment_id>/decisions/<uuid:decision_id>/', AutoModeDecisionResolveView.as_view(),
         name='automode-decision-resolve'),
]
