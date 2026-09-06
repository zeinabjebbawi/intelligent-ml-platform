from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from projects.models import Project
from datasets.models import DatasetVersion
from .models import TrainedModel
from .serializers import TrainedModelSerializer


def _get_project(project_id, user):
    # get_object_or_404(..., user=user) rather than a raw pk lookup — same
    # security pattern used everywhere else in this codebase (datasets/
    # version_views.py, experiments/views.py): a project belonging to
    # someone else returns 404, not 403, so its existence is never revealed
    # to a requester who isn't its owner.
    return get_object_or_404(Project, pk=project_id, user=user)


class TrainedModelListCreateView(APIView):
    """
    GET  /api/projects/<uuid:project_id>/trained-models/
         Every trained model this project still has (excludes soft-deleted
         rows), newest first — this is what lets TrainTest.jsx's Model
         History survive a browser/device change, not just a page refresh.

    POST /api/projects/<uuid:project_id>/trained-models/
         Body: {dataset_version?, model_id, model_file, algorithm,
                display_name?, task_type, target_column?, hyperparameters?,
                metrics?, confusion_matrix?, feature_importance?,
                result_data?}

         Called by the frontend right after a real /training/train call
         (Manual Mode) or Auto Mode's train node succeeds — FastAPI itself
         never talks to Django for this, mirroring how dataset versions
         get registered (VersionRegisterView) rather than being written by
         FastAPI directly.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        project = _get_project(project_id, request.user)
        queryset = project.trained_models.exclude(status='deleted')
        return Response(TrainedModelSerializer(queryset, many=True).data)

    def post(self, request, project_id):
        project = _get_project(project_id, request.user)
        data = request.data

        dataset_version = None
        if data.get('dataset_version'):
            dataset_version = get_object_or_404(
                DatasetVersion, pk=data['dataset_version'], dataset__project=project)

        trained_model = TrainedModel.objects.create(
            project=project,
            dataset_version=dataset_version,
            model_id=data.get('model_id', ''),
            model_file=data.get('model_file', ''),
            algorithm=data.get('algorithm') or '',
            display_name=data.get('display_name') or '',
            task_type=data.get('task_type') or '',
            target_column=data.get('target_column') or '',
            hyperparameters=data.get('hyperparameters') or {},
            metrics=data.get('metrics') or {},
            confusion_matrix=data.get('confusion_matrix') or {},
            feature_importance=data.get('feature_importance') or {},
            result_data=data.get('result_data') or {},
        )
        return Response(TrainedModelSerializer(trained_model).data, status=status.HTTP_201_CREATED)


class TrainedModelDetailView(APIView):
    """
    DELETE /api/projects/<uuid:project_id>/trained-models/<uuid:model_pk>/

    Soft-delete only (status -> 'deleted', excluded from the list view
    above) — the row itself is kept as a real historical record rather
    than erased outright, same reasoning AgentDecision already documents
    for a rejected HITL checkpoint. The physical .pkl file on FastAPI's
    disk is a separate, unmanaged concern this endpoint does not touch.
    """
    permission_classes = [IsAuthenticated]

    def delete(self, request, project_id, model_pk):
        project = _get_project(project_id, request.user)
        trained_model = get_object_or_404(TrainedModel, pk=model_pk, project=project)
        trained_model.status = 'deleted'
        trained_model.save(update_fields=['status'])
        return Response(status=status.HTTP_204_NO_CONTENT)
