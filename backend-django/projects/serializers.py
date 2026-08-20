from rest_framework import serializers
from .models import Project, WorkflowState


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

    class Meta:
        model = Project
        fields = ['id', 'name', 'description', 'mode', 'status',
                  'workflow_state', 'created_at', 'updated_at']
        # These fields are set automatically and cannot be changed by the client
        read_only_fields = ['id', 'created_at', 'updated_at']
