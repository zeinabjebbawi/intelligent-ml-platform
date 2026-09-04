from rest_framework import serializers
from .models import Project, WorkflowState
from datasets.serializers import DatasetSummarySerializer


class WorkflowStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowState
        # These are the fields sent to the frontend for the Journey Map
        fields = ['current_step', 'completed_steps', 'needs_redo_steps',
                  'step_settings', 'updated_at']


class ProjectSerializer(serializers.ModelSerializer):
    # workflow_state is a nested serializer — it embeds the full workflow state
    # inside the project response so the frontend gets everything in one call
    # read_only=True means workflow_state cannot be set directly through this serializer
    workflow_state = WorkflowStateSerializer(read_only=True)

    # The most recently uploaded Dataset for this project (Dataset.Meta's own
    # '-upload_timestamp' ordering does the "latest" part), embedded the same
    # way workflow_state is — lets Workspace.jsx's "Open" flow rebuild
    # uploadMeta.targetColumn/.taskType in the SAME /api/projects/ call that
    # already lists every project, no second round trip per project. None
    # for a project nobody has ever uploaded a file to.
    latest_dataset = serializers.SerializerMethodField()

    def get_latest_dataset(self, project):
        dataset = project.datasets.first()  # related_name='datasets', ordered '-upload_timestamp'
        return DatasetSummarySerializer(dataset).data if dataset else None

    class Meta:
        model = Project
        fields = ['id', 'name', 'description', 'mode', 'status',
                  'workflow_state', 'latest_dataset', 'created_at', 'updated_at']
        # These fields are set automatically and cannot be changed by the client
        read_only_fields = ['id', 'created_at', 'updated_at']
