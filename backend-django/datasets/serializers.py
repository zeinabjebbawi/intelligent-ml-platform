from rest_framework import serializers
from .models import Dataset, DatasetVersion


class DatasetVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DatasetVersion
        fields = ['id', 'version_number', 'step_name', 'step_order',
                  'version_label', 'file_path', 'file_size', 'row_count',
                  'col_count', 'summary', 'transformations_applied', 'created_at']


class DatasetSerializer(serializers.ModelSerializer):
    # versions is a reverse relation — because DatasetVersion has a ForeignKey to Dataset,
    # we can access all versions of a dataset through dataset.versions.all()
    # related_name='versions' in the model definition enabled this
    versions = DatasetVersionSerializer(many=True, read_only=True)

    class Meta:
        model = Dataset
        fields = ['id', 'original_filename', 'row_count', 'column_count',
                  'health_score', 'columns_metadata', 'profiling_result',
                  'status', 'upload_timestamp', 'versions',
                  'target_column', 'task_type']


class DatasetSummarySerializer(serializers.ModelSerializer):
    """Lightweight subset embedded in ProjectSerializer's `latest_dataset` —
    just enough for the Workspace "Open" flow to rebuild uploadMeta without
    a second round trip, never the full versions/profiling_result payload
    DatasetSerializer carries for the dataset's own detail page."""
    class Meta:
        model = Dataset
        fields = ['id', 'original_filename', 'row_count', 'column_count',
                  'target_column', 'task_type']
