"""Pozycja planu: obciążenie w jednym z trzech trybów (WF-09).

Dotychczasowe pole target_percent_1rm przenosimy do load_value (load_type='percent'),
a author_weight zmieniamy na calculated_weight bez utraty danych.
"""
from django.db import migrations, models


def copy_percent(apps, schema_editor):
    PlanExercise = apps.get_model('training', 'PlanExercise')
    for pe in PlanExercise.objects.all():
        pe.load_type = 'percent'
        pe.load_value = pe.target_percent_1rm
        pe.save(update_fields=['load_type', 'load_value'])


class Migration(migrations.Migration):
    dependencies = [('training', '0003_personalrecord_planexercise')]

    operations = [
        migrations.AlterUniqueTogether(name='planexercise', unique_together=set()),
        migrations.RenameField('planexercise', 'author_weight', 'calculated_weight'),
        migrations.AddField('planexercise', 'load_type', models.CharField(
            choices=[('percent', '% 1RM'), ('rpe', 'RPE'), ('kg', 'kg')], default='percent', max_length=10)),
        migrations.AddField('planexercise', 'load_value', models.FloatField(default=75.0)),
        migrations.RunPython(copy_percent, migrations.RunPython.noop),
        migrations.RemoveField('planexercise', 'target_percent_1rm'),
    ]
