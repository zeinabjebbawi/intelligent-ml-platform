from django.urls import path
from .views import ProjectListCreateView, ProjectDetailView, WorkflowStateView

urlpatterns = [
    # GET /api/projects/       → list all user's projects
    # POST /api/projects/      → create new project
    path('', ProjectListCreateView.as_view(), name='project-list-create'),

    # GET /api/projects/<uuid>/    → get single project
    # PUT /api/projects/<uuid>/    → update project
    # DELETE /api/projects/<uuid>/ → delete project
    # <uuid:pk> means Django automatically validates that the URL segment is a UUID
    path('<uuid:pk>/', ProjectDetailView.as_view(), name='project-detail'),

    # GET/PATCH /api/projects/<uuid:project_id>/workflow/ → current step,
    # completed/needs-redo steps, cached per-step settings (see WorkflowStateView)
    path('<uuid:project_id>/workflow/', WorkflowStateView.as_view(), name='workflow-state'),
]
