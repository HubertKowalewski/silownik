"""Eksport raportu okresowego do CSV i PDF (WF-34).

PDF zawiera wykresy (reportlab.graphics) i korzysta z czcionki DejaVu Sans dołączonej
do projektu, ponieważ standardowe czcionki PDF nie zawierają polskich znaków.
"""
import csv
import io
from pathlib import Path

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.charts.legends import Legend
from reportlab.graphics.charts.linecharts import HorizontalLineChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

FONT_DIR = Path(__file__).resolve().parent / 'fonts'
MEASUREMENT_LABELS = {
    'body_weight': 'Masa ciała [kg]', 'waist': 'Talia [cm]', 'chest': 'Klatka piersiowa [cm]',
    'arm': 'Ramię [cm]', 'thigh': 'Udo [cm]', 'hips': 'Biodra [cm]', 'resting_hr': 'Tętno spoczynkowe [ud./min]',
}
SERIES_COLORS = [colors.HexColor('#4d7c0f'), colors.HexColor('#7c3aed'), colors.HexColor('#d97706')]


def _fmt(value, suffix=''):
    if value is None:
        return '–'
    if isinstance(value, float):
        value = f'{value:.1f}'.replace('.', ',')
    return f'{value}{suffix}'


def _signed(value, suffix=''):
    if value is None:
        return '–'
    return ('+' if value > 0 else '') + _fmt(value, suffix)


def short(name: str) -> str:
    return name.split(' / ')[0]


def summary_rows(report):
    return [
        ('Okres', f"{report['date_from']} – {report['date_to']} ({_fmt(report['weeks'])} tyg.)"),
        ('Treningi (średnio w tygodniu)', f"{report['sessions']} ({_fmt(report['sessions_per_week'])})"),
        ('Średni czas treningu', _fmt(report['avg_duration_min'], ' min')),
        ('Aktywny plan', report['plan'] or '–'),
        ('Treningi zaplanowane / wykonane z planem',
         f"{report['planned_sessions']} / {report['completed_plan_sessions']}"),
        ('Regularność względem planu', _fmt(report['adherence_percent'], ' %')),
        ('Średnia realizacja jednostek planu', _fmt(report['avg_plan_completion_percent'], ' %')),
        ('Serie robocze', report['total_sets']),
        ('Objętość treningowa', f"{report['total_tonnage']} kg"),
        ('Średni RIR (powtórzenia w zapasie)',
         f"{_fmt(report['effort']['avg_rir'])} (ocenione serie: {report['effort']['rated_sets']})"),
        ('Serie do upadku (RIR 0)', _fmt(report['effort']['to_failure_percent'], ' %')),
    ]


def report_to_csv(report) -> str:
    buffer = io.StringIO()
    buffer.write('\ufeff')  # BOM - poprawne polskie znaki po otwarciu w arkuszu kalkulacyjnym
    w = csv.writer(buffer, delimiter=';')
    w.writerow(['Raport postępów', report['user']])
    for label, value in summary_rows(report):
        w.writerow([label, value])
    w.writerow([])
    w.writerow(['Porównanie z poprzednim okresem', 'Ten okres', 'Poprzedni okres', 'Zmiana [%]'])
    for c in report['comparison']:
        w.writerow([c['metric'], c['current'], c['previous'], c['change_percent'] if c['change_percent'] is not None else ''])
    w.writerow([])
    w.writerow(['Data', 'Trening', 'Czas [min]', 'Serie', 'Objętość [kg]', 'Realizacja planu [%]'])
    for s in report['session_list']:
        w.writerow([s['date'], s['name'], s['duration_min'] or '', s['sets'], s['tonnage'],
                    s['completion_percent'] if s['completion_percent'] is not None else ''])
    w.writerow([])
    w.writerow(['Tydzień od', 'Objętość [kg]', 'Serie'])
    for wk in report['weekly']:
        w.writerow([wk['week'], wk['tonnage'], wk['sets']])
    w.writerow([])
    w.writerow(['Ćwiczenie', '1RM na początku [kg]', 'Najlepsze 1RM [kg]', 'Zmiana [kg]', 'Rekord'])
    for p in report['progress']:
        w.writerow([p['exercise'], p['start_1rm'], p['best_1rm'], p['change'], 'tak' if p['record'] else ''])
    w.writerow([])
    w.writerow(['Partia mięśniowa', 'Serie', 'Serie efektywne / tydzień', 'Objętość [kg]'])
    for m in report['muscle_split']:
        w.writerow([m['group'], m['sets'], m['hard_sets_per_week'], m['tonnage']])
    w.writerow([])
    w.writerow(['Rekord powtórzeniowy', 'Powtórzenia', 'Ciężar [kg]', 'Poprzednio [kg]'])
    for r in report['rep_records']:
        w.writerow([r['exercise'], r['reps'], r['weight'], r['previous'] or ''])
    w.writerow([])
    w.writerow(['Cel', 'Docelowe 1RM [kg]', 'Obecne 1RM [kg]', 'Postęp [%]'])
    for g in report['goals']:
        w.writerow([g['exercise'], g['target_1rm'], g['current_1rm'], g['progress_percent']])
    w.writerow([])
    w.writerow(['Pomiar', 'Początek okresu', 'Koniec okresu', 'Zmiana'])
    for field, v in report['measurements'].items():
        w.writerow([MEASUREMENT_LABELS[field], v['start'] or '', v['end'] or '', v['change'] if v['change'] is not None else ''])
    return buffer.getvalue()


# --- PDF -------------------------------------------------------------------------

def _register_fonts():
    if 'DejaVu' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('DejaVu', str(FONT_DIR / 'DejaVuSans.ttf')))
        pdfmetrics.registerFont(TTFont('DejaVu-Bold', str(FONT_DIR / 'DejaVuSans-Bold.ttf')))


def _table(rows, header=True, widths=None):
    table = Table(rows, colWidths=widths, hAlign='LEFT', repeatRows=1 if header else 0)
    style = [
        ('FONT', (0, 0), (-1, -1), 'DejaVu', 8.5),
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#BBBBBB')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [('FONT', (0, 0), (-1, 0), 'DejaVu-Bold', 8.5),
                  ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EEEEEE'))]
    table.setStyle(TableStyle(style))
    return table


def _axis_fonts(chart):
    for axis in (chart.categoryAxis, chart.valueAxis):
        axis.labels.fontName = 'DejaVu'
        axis.labels.fontSize = 7


def weekly_chart(weekly) -> Drawing:
    d = Drawing(16 * cm, 5.5 * cm)
    chart = VerticalBarChart()
    chart.x, chart.y, chart.width, chart.height = 40, 25, 16 * cm - 55, 5.5 * cm - 45
    chart.data = [[w['tonnage'] for w in weekly]]
    chart.categoryAxis.categoryNames = [w['week'] for w in weekly]
    chart.categoryAxis.labels.angle = 45 if len(weekly) > 12 else 0
    chart.categoryAxis.labels.boxAnchor = 'ne' if len(weekly) > 12 else 'n'
    chart.valueAxis.valueMin = 0
    chart.bars[0].fillColor = SERIES_COLORS[0]
    chart.bars[0].strokeColor = None
    _axis_fonts(chart)
    d.add(chart)
    d.add(String(0, 5.5 * cm - 10, 'Objętość tygodniowa [kg]', fontName='DejaVu-Bold', fontSize=8))
    return d


def progress_chart(series) -> Drawing:
    weeks = [w for _, w in sorted({(p['date'], p['week']) for s in series for p in s['points']})]
    d = Drawing(16 * cm, 7 * cm)
    chart = HorizontalLineChart()
    chart.x, chart.y, chart.width, chart.height = 40, 62, 16 * cm - 55, 7 * cm - 82
    data = []
    for s in series:
        values = {p['week']: p['e1rm'] for p in s['points']}
        row, last = [], None
        for wk in weeks:  # brak treningu w tygodniu - linia utrzymuje poprzednią wartość
            last = values.get(wk, last)
            row.append(last if last is not None else 0)
        data.append(row)
    chart.data = data
    chart.categoryAxis.categoryNames = weeks
    lows = [v for row in data for v in row if v]
    chart.valueAxis.valueMin = max(0, (min(lows) if lows else 0) * 0.9)
    for i in range(len(series)):
        chart.lines[i].strokeColor = SERIES_COLORS[i % 3]
        chart.lines[i].strokeWidth = 1.8
    _axis_fonts(chart)
    d.add(chart)
    legend = Legend()
    legend.x, legend.y = 40, 40
    legend.alignment = 'right'
    legend.columnMaximum = 3
    legend.fontName, legend.fontSize = 'DejaVu', 7
    legend.colorNamePairs = [(SERIES_COLORS[i % 3], short(s['exercise'])) for i, s in enumerate(series)]
    legend.dx, legend.dy, legend.deltay = 8, 8, 10
    d.add(legend)
    d.add(String(0, 7 * cm - 10, 'Szacowane 1RM w kolejnych tygodniach [kg]', fontName='DejaVu-Bold', fontSize=8))
    return d


def report_to_pdf(report) -> bytes:
    _register_fonts()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm,
                            topMargin=1.8 * cm, bottomMargin=1.8 * cm,
                            title=f"Raport postępów {report['user']}", author='Siłownik', creator='Siłownik')
    h1 = ParagraphStyle('h1', fontName='DejaVu-Bold', fontSize=16, leading=20, spaceAfter=4)
    h2 = ParagraphStyle('h2', fontName='DejaVu-Bold', fontSize=11.5, spaceBefore=12, spaceAfter=5)
    body = ParagraphStyle('body', fontName='DejaVu', fontSize=8.5, textColor=colors.HexColor('#444444'), leading=11)
    cell = ParagraphStyle('cell', fontName='DejaVu', fontSize=8.5, leading=10)

    story = [
        Paragraph('Raport postępów treningowych', h1),
        Paragraph(f"Użytkownik: {report['user']} · okres {report['date_from']} – {report['date_to']}", body),
        Spacer(1, 8),
        _table([[k, str(v)] for k, v in summary_rows(report)], header=False, widths=[8 * cm, 9 * cm]),
        Paragraph('Porównanie z poprzednim okresem tej samej długości', h2),
        _table([['Miara', 'Ten okres', 'Poprzedni', 'Zmiana']] +
               [[c['metric'], str(c['current']), str(c['previous']), _signed(c['change_percent'], ' %')]
                for c in report['comparison']], widths=[6 * cm, 3.5 * cm, 3.5 * cm, 4 * cm]),
    ]
    if report['weekly']:
        story += [Spacer(1, 10), weekly_chart(report['weekly'])]

    story.append(Paragraph('Treningi w okresie', h2))
    if report['session_list']:
        rows = [['Data', 'Trening', 'Czas', 'Serie', 'Objętość', 'Plan']]
        rows += [[s['date'], Paragraph(s['name'], cell), _fmt(s['duration_min'], ' min'), str(s['sets']),
                  f"{s['tonnage']} kg", _fmt(s['completion_percent'], ' %')] for s in report['session_list'][:60]]
        story.append(_table(rows, widths=[2.2 * cm, 6.6 * cm, 1.8 * cm, 1.4 * cm, 2.4 * cm, 1.6 * cm]))
        if len(report['session_list']) > 60:
            story.append(Paragraph(f"… oraz {len(report['session_list']) - 60} kolejnych (pełna lista w eksporcie CSV).", body))
    else:
        story.append(Paragraph('Brak treningów w wybranym okresie.', body))

    story.append(Paragraph('Zmiana szacowanego 1RM', h2))
    if report['progress']:
        rows = [['Ćwiczenie', 'Początek', 'Najlepsze', 'Zmiana', 'Rekord']]
        rows += [[Paragraph(short(p['exercise']), cell), _fmt(p['start_1rm']), _fmt(p['best_1rm']),
                  _signed(p['change']), 'tak' if p['record'] else ''] for p in report['progress'][:20]]
        story.append(_table(rows, widths=[8.5 * cm, 2 * cm, 2 * cm, 2 * cm, 1.5 * cm]))
        if any(len(s['points']) > 1 for s in report['progress_series']):
            story += [Spacer(1, 10), progress_chart(report['progress_series'])]
    else:
        story.append(Paragraph('Brak serii do estymacji 1RM w wybranym okresie.', body))

    if report['rep_records']:
        story.append(Paragraph('Rekordy powtórzeniowe pobite w okresie', h2))
        rows = [['Ćwiczenie', 'Powtórzenia', 'Ciężar', 'Poprzednio']]
        rows += [[Paragraph(short(r['exercise']), cell), str(r['reps']), _fmt(r['weight'], ' kg'),
                  _fmt(r['previous'], ' kg')] for r in report['rep_records'][:25]]
        story.append(_table(rows, widths=[8.5 * cm, 2.5 * cm, 3 * cm, 3 * cm]))

    story.append(Paragraph('Partie mięśniowe', h2))
    if report['muscle_split']:
        story.append(Paragraph('Serie efektywne to serie robocze z RIR ≤ 4 lub bez oceny wysiłku, '
                               'w przeliczeniu na tydzień okresu.', body))
        story.append(Spacer(1, 4))
        story.append(_table([['Partia', 'Serie', 'Serie efektywne / tydz.', 'Objętość']] +
                            [[m['group'], str(m['sets']), _fmt(m['hard_sets_per_week']), f"{m['tonnage']} kg"]
                             for m in report['muscle_split']], widths=[6.5 * cm, 2.5 * cm, 4.5 * cm, 3.5 * cm]))
    else:
        story.append(Paragraph('Brak danych.', body))

    if report['goals']:
        story.append(Paragraph('Cele siłowe', h2))
        story.append(_table([['Cel', 'Docelowe 1RM', 'Obecne 1RM', 'Postęp']] +
                            [[Paragraph(short(g['exercise']), cell), _fmt(g['target_1rm'], ' kg'),
                              _fmt(g['current_1rm'], ' kg'),
                              'osiągnięty' if g['achieved'] else _fmt(g['progress_percent'], ' %')]
                             for g in report['goals']], widths=[8 * cm, 3 * cm, 3 * cm, 3 * cm]))

    story.append(KeepTogether([
        Paragraph('Pomiary ciała', h2),
        _table([['Parametr', 'Początek okresu', 'Koniec okresu', 'Zmiana']] +
               [[MEASUREMENT_LABELS[f], _fmt(v['start']), _fmt(v['end']), _signed(v['change'])]
                for f, v in report['measurements'].items()], widths=[6.5 * cm, 3.5 * cm, 3.5 * cm, 3.5 * cm]),
    ]))
    doc.build(story)
    return buffer.getvalue()
