from rest_framework import serializers
from .models import Experiment, AgentDecision, TrainedModel


class AgentDecisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentDecision
        fields = ['id', 'decision_type', 'input_context', 'decision_output', 'reasoning',
                  'requires_confirmation', 'confirmed', 'user_override', 'created_at']
        read_only_fields = ['id', 'created_at']


class ExperimentSerializer(serializers.ModelSerializer):
    agent_decisions = AgentDecisionSerializer(many=True, read_only=True)

    class Meta:
        model = Experiment
        fields = ['id', 'project', 'dataset_version', 'task_type', 'target_column', 'algorithm',
                  'hyperparameters', 'metrics', 'feature_importance', 'confusion_matrix', 'status',
                  'current_node', 'created_at', 'updated_at', 'agent_decisions']
        read_only_fields = ['id', 'created_at', 'updated_at']


class TrainedModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = TrainedModel
        fields = ['id', 'project', 'dataset_version', 'model_id', 'model_file', 'algorithm',
                  'display_name', 'task_type', 'target_column', 'hyperparameters', 'metrics',
                  'confusion_matrix', 'feature_importance', 'result_data', 'status', 'created_at']
        read_only_fields = ['id', 'created_at']
