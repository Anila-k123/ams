"""Citation verification — confirm a generated block really matches its source.

A DraftBlock sourced from a sample clause is only marked ``verified`` when the
generated text is semantically close to the cited clause. We measure that with
cosine similarity between their embeddings and gate on a fixed threshold, so the
"verified" flag is decided by code, never by the LLM's own claim.
"""
import numpy as np

# Minimum cosine similarity for a generated block to count as a verified citation.
VERIFICATION_THRESHOLD = 0.70


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity of two embedding vectors, in [-1, 1] (0.0 if either is zero-length)."""
    va, vb = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    # Guard against division by zero for an empty/zero vector.
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def verify_citation(generated_text: str, source_clause_embedding: list[float]) -> tuple[bool, float]:
    """Embed the generated text and compare cosine similarity to the source clause.
    Returns (verified, similarity_score).
    """
    from drafting.providers.embeddings import get_embeddings
    gen_embedding = get_embeddings().embed(generated_text)
    score = cosine_similarity(gen_embedding, source_clause_embedding)
    return score >= VERIFICATION_THRESHOLD, score
