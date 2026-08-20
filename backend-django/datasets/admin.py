from django.contrib import admin
from .models import Dataset, DatasetVersion


@admin.register(Dataset)
class DatasetAdmin(admin.ModelAdmin):
    list_display = ['original_filename', 'project', 'health_score', 'status', 'upload_timestamp']
    list_filter = ['status']


@admin.register(DatasetVersion)
class DatasetVersionAdmin(admin.ModelAdmin):
    list_display = ['dataset', 'version_number', 'step_name', 'version_label', 'created_at']
    list_filter = ['step_name']
