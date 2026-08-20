from django.contrib import admin
from .models import Project, WorkflowState


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'mode', 'status', 'created_at']
    list_filter = ['mode', 'status']


@admin.register(WorkflowState)
class WorkflowStateAdmin(admin.ModelAdmin):
    list_display = ['project', 'current_step', 'updated_at']
