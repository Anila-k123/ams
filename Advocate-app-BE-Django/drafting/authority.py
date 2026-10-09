"""Who has authority over whose drafts, for review (docs/DRAFT_REVIEW.md).

The rule: whoever has authority over a draft decides; everyone else can only suggest.
A reviewer is "senior over" an author when, in the same team, they are the team head
(the practice root), or they hold TASK_ASSIGN, the permission that lets them hand work
to the author. Nobody is senior over the team head, and nobody over themselves.
"""

from core.practice import practice_root


def _codes(user):
    perms = getattr(user, '_advocate_permissions', None)
    return perms if perms is not None else user.permission_codes()


def is_senior_over(reviewer, author):
    """reviewer and author are Advocates (author may be an id)."""
    if isinstance(author, int):
        from core.models import Advocate
        author = Advocate.objects.filter(id=author).first()
    if author is None or reviewer.id == author.id:
        return False
    team = practice_root(author)
    if practice_root(reviewer) != team or author.id == team:
        return False   # another team, or the author is the team head
    return reviewer.id == team or 'TASK_ASSIGN' in _codes(reviewer)
