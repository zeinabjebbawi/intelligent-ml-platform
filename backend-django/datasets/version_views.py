import os
from django.db.models import Max
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from projects.models import Project, WorkflowState
from .models import Dataset, DatasetVersion, STEP_ORDER
from .serializers import DatasetVersionSerializer


def get_project_and_dataset(project_id, user):
    """
    Resolve a project (scoped to the requesting user — see ProjectDetailView
    for why this pattern, not a raw pk lookup, is the security-relevant part)
    and its active dataset.

    A project can only ever have one *active* dataset in this platform today
    (one CSV uploaded per project, versioned forward from there), so "most
    recently uploaded" is the correct and only sensible choice — there is no
    dataset picker anywhere in the UI.
    """
    project = get_object_or_404(Project, pk=project_id, user=user)
    dataset = Dataset.objects.filter(project=project).order_by('-upload_timestamp').first()
    return project, dataset


class VersionListView(APIView):
    """GET /api/projects/<uuid:project_id>/versions/ — full version history."""
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id):
        _, dataset = get_project_and_dataset(project_id, request.user)
        if not dataset:
            return Response([])
        serializer = DatasetVersionSerializer(dataset.versions.all(), many=True)
        return Response(serializer.data)


class VersionForStepView(APIView):
    """
    GET /api/projects/<uuid:project_id>/versions/for-step/<step_name>/

    Returns the dataset a given step should load: the most recent version
    whose step_order is strictly less than this step's own order. This is
    what lets the user navigate backward/forward through the journey map
    and always land on the correct upstream dataset, per Global Rule 4
    (dataset versioning) — a step never silently operates on a downstream
    version of the data.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id, step_name):
        _, dataset = get_project_and_dataset(project_id, request.user)
        target_order = STEP_ORDER.get(step_name, 99)

        if not dataset:
            return Response({"found": False, "file_path": None})

        version = (
            dataset.versions
            .filter(step_order__lt=target_order)
            .order_by('-step_order', '-created_at')
            .first()
        )
        if version:
            return Response({
                "found": True,
                "file_path": version.file_path,
                "step_name": version.step_name,
                "version_label": version.version_label,
                "row_count": version.row_count,
            })

        # No upstream version registered yet (e.g. user is on the very first
        # cleaning step) — fall back to the original uploaded file rather
        # than erroring, since that IS the correct input for step_order 2/3.
        return Response({
            "found": False,
            "file_path": dataset.storage_path,
            "step_name": "upload",
            "version_label": "Original Dataset",
            "row_count": dataset.row_count,
        })


class VersionRegisterView(APIView):
    """
    POST /api/projects/<uuid:project_id>/versions/register/
    Body: {step_name, file_path, version_label?, row_count?, col_count?, summary?}

    Registers a new DatasetVersion. Does NOT cascade-delete anything itself —
    the frontend is expected to call VersionCascadeView first (with the
    user's confirmation) if this registration is a redo of an earlier step.
    Doing the delete here implicitly, without a confirmation round-trip,
    is exactly what Global Rule 3 (no silent destructive action) rules out.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, project_id):
        project, dataset = get_project_and_dataset(project_id, request.user)

        step_name = request.data.get('step_name')
        file_path = request.data.get('file_path')
        if not step_name or not file_path:
            return Response(
                {"error": "step_name and file_path are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not dataset:
            # Registering a version presumes a Dataset row exists (it's what
            # DatasetVersion.dataset FKs to), but a project can reach this
            # endpoint without ever going through DatasetUploadView — e.g.
            # the frontend's temporary dev harness hands FastAPI a raw CSV
            # path directly, skipping Django's upload flow entirely. Rather
            # than error here, self-heal: create the Dataset row lazily from
            # whatever file is being registered as this step's output, same
            # as a real upload would, just without copying the file into
            # media/ (it's already wherever the caller put it).
            import pandas as pd
            try:
                probe_df = pd.read_csv(file_path)
                probe_rows, probe_cols = len(probe_df), len(probe_df.columns)
            except Exception:
                probe_rows, probe_cols = 0, 0
            dataset = Dataset.objects.create(
                project=project,
                original_filename=os.path.basename(file_path),
                storage_path=file_path,
                row_count=probe_rows,
                column_count=probe_cols,
                status='uploaded',
            )

        next_num = (
            dataset.versions.aggregate(Max('version_number'))['version_number__max'] or 0
        ) + 1
        file_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0

        version = DatasetVersion.objects.create(
            dataset=dataset,
            version_number=next_num,
            step_name=step_name,
            version_label=request.data.get('version_label') or step_name,
            file_path=file_path,
            file_size=file_size,
            row_count=request.data.get('row_count') or 0,
            col_count=request.data.get('col_count') or 0,
            summary=request.data.get('summary') or {},
        )
        return Response(DatasetVersionSerializer(version).data, status=status.HTTP_201_CREATED)


class VersionCascadeView(APIView):
    """
    DELETE /api/projects/<uuid:project_id>/versions/cascade/<step_name>/

    Deletes every DatasetVersion with step_order >= this step's order (the
    step being redone, plus everything downstream of it), and marks those
    same steps as needing redo in WorkflowState — clearing them out of
    completed_steps so the journey map stops showing them as done.

    Intentionally does NOT touch anything else (no Experiment/model deletion
    here — that's out of scope for the Cleaning-page work this endpoint was
    built for, and deleting trained models is a bigger, separate decision).
    """
    permission_classes = [IsAuthenticated]

    def delete(self, request, project_id, step_name):
        project, dataset = get_project_and_dataset(project_id, request.user)
        target_order = STEP_ORDER.get(step_name, 99)

        deleted_steps = []
        if dataset:
            to_delete = dataset.versions.filter(step_order__gte=target_order)
            deleted_steps = sorted(set(to_delete.values_list('step_name', flat=True)))
            to_delete.delete()

        workflow, _ = WorkflowState.objects.get_or_create(project=project)
        workflow.completed_steps = [
            s for s in workflow.completed_steps if STEP_ORDER.get(s, 99) < target_order
        ]
        workflow.needs_redo_steps = sorted(set(workflow.needs_redo_steps) | set(deleted_steps))
        workflow.save()

        return Response({
            "deleted_steps": deleted_steps,
            "warning": (
                f"These steps need to be redone: {', '.join(deleted_steps)}."
                if deleted_steps else ""
            ),
        })


class VersionDownloadView(APIView):
    """GET /api/projects/<uuid:project_id>/versions/<uuid:version_id>/download/"""
    permission_classes = [IsAuthenticated]

    def get(self, request, project_id, version_id):
        _, dataset = get_project_and_dataset(project_id, request.user)
        version = get_object_or_404(DatasetVersion, pk=version_id, dataset=dataset)

        if not os.path.exists(version.file_path):
            return Response(
                {"error": "This version's file is no longer on disk."},
                status=status.HTTP_404_NOT_FOUND,
            )

        filename = f"{version.version_label.replace(' ', '_')}.csv"
        return FileResponse(open(version.file_path, 'rb'), as_attachment=True, filename=filename)
