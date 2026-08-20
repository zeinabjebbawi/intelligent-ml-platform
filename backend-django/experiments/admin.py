from django.contrib import admin
from .models import Experiment, AgentDecision, InsightCard, WhatIfSimulation, Report


@admin.register(Experiment)
class ExperimentAdmin(admin.ModelAdmin):
    list_display = ['algorithm', 'task_type', 'status', 'project', 'created_at']
    list_filter = ['task_type', 'status']


@admin.register(AgentDecision)
class AgentDecisionAdmin(admin.ModelAdmin):
    list_display = ['decision_type', 'experiment', 'created_at']


@admin.register(InsightCard)
class InsightCardAdmin(admin.ModelAdmin):
    list_display = ['title', 'severity', 'card_type', 'experiment', 'created_at']
    list_filter = ['severity']


@admin.register(WhatIfSimulation)
class WhatIfSimulationAdmin(admin.ModelAdmin):
    list_display = ['experiment', 'confidence', 'scenario_label', 'created_at']


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ['project', 'experiment', 'created_at']
