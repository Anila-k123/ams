from rest_framework import serializers

from .models import Act, ActPaper, Chapter, Section


def _jurisdiction_label(state_name: str) -> str:
    return 'ALL INDIA' if state_name == 'CENTRAL' else state_name.upper()


class ActListSerializer(serializers.ModelSerializer):
    """One search-result card's worth of fields."""
    jurisdiction = serializers.SerializerMethodField()
    actNumber = serializers.CharField(source='act_number')
    actYear = serializers.IntegerField(source='act_year')
    description = serializers.CharField(source='abstract')
    ministry = serializers.CharField(source='ministry_name')
    department = serializers.CharField(source='department_name')
    enactmentDate = serializers.DateField(source='enact_date')
    enforcementDate = serializers.CharField(source='enforcement_date')
    noOfSection = serializers.IntegerField(source='no_of_section')

    class Meta:
        model = Act
        fields = ['id', 'title', 'jurisdiction', 'actNumber', 'actYear', 'description',
                  'ministry', 'department', 'enactmentDate', 'enforcementDate',
                  'repealed', 'noOfSection']

    def get_jurisdiction(self, obj):
        return _jurisdiction_label(obj.source_state_name)


class ChapterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chapter
        fields = ['id', 'number', 'title', 'order']


class SectionListSerializer(serializers.ModelSerializer):
    """A section link in the Sections tab - number/title only, no body text.
    Full content/footnote is fetched on demand via ActSectionDetailView, same
    as Provakil only shows Contents/Footnotes once you open one section."""
    class Meta:
        model = Section
        fields = ['id', 'number', 'title', 'order_number']


class ActPaperSerializer(serializers.ModelSerializer):
    """One Act Papers row - a RULE or NOTIFICATION item, few enough per act
    (0-2 typically) to embed eagerly, unlike Sections' lazy per-item fetch."""
    paperType = serializers.CharField(source='paper_type')
    paperDate = serializers.DateField(source='paper_date')
    pdfUrl = serializers.CharField(source='pdf_url')

    class Meta:
        model = ActPaper
        fields = ['id', 'paperType', 'title', 'paperDate', 'pdfUrl']


class ActDetailSerializer(ActListSerializer):
    longTitle = serializers.CharField(source='long_title')
    preambleHtml = serializers.CharField(source='preamble_html')
    noOfChapter = serializers.IntegerField(source='no_of_chapter')
    pdfUrl = serializers.CharField(source='pdf_url')
    chapters = ChapterSerializer(many=True, read_only=True)
    sections = serializers.SerializerMethodField()
    papers = serializers.SerializerMethodField()
    caseLinksCount = serializers.SerializerMethodField()

    class Meta(ActListSerializer.Meta):
        fields = ActListSerializer.Meta.fields + [
            'longTitle', 'preambleHtml', 'noOfChapter', 'pdfUrl', 'chapters', 'sections',
            'papers', 'caseLinksCount',
        ]

    def get_sections(self, obj):
        return SectionListSerializer(obj.sections.order_by('order_number'), many=True).data

    def get_papers(self, obj):
        return ActPaperSerializer(obj.papers.order_by('-paper_date'), many=True).data

    def get_caseLinksCount(self, obj):
        return obj.case_links.count()


class SectionDetailSerializer(serializers.ModelSerializer):
    """Full Contents + Footnotes for one section, fetched lazily."""
    class Meta:
        model = Section
        fields = ['id', 'number', 'title', 'content', 'footnote', 'order_number']
