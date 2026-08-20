from django.contrib import admin
from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'experience_level', 'onboarding_completed', 'created_at']
    list_filter = ['experience_level', 'onboarding_completed']
