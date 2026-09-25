"""Embedding provider abstraction — the single entry point for vectorising text.

Sample clauses are embedded once at ingest and stored as pgvector columns;
generated blocks are embedded on the fly for citation verification. Both go
through the cached singleton returned by ``get_embeddings()`` so the (heavy)
model is loaded only once per process.
"""
from django.conf import settings
from langchain_community.embeddings import HuggingFaceEmbeddings


class EmbeddingProvider:
    """Wraps HuggingFaceEmbeddings (sentence-transformers) for nomic-embed-text.
    Output dimension must match EMBED_DIM in settings (768 for nomic-embed-text-v1).
    """

    def __init__(self):
        # nomic-embed-text-v1 ships custom modeling code (nomic-bert-2048),
        # so trust_remote_code=True is required; that code also needs `einops`.
        self._model = HuggingFaceEmbeddings(
            model_name=settings.EMBED_MODEL,
            model_kwargs={'device': 'cpu', 'trust_remote_code': True},
            encode_kwargs={'normalize_embeddings': True},
        )
        self.dim = settings.EMBED_DIM

    def embed(self, text: str) -> list[float]:
        """Embed a single string (a query/clause) into one EMBED_DIM-length vector."""
        return self._model.embed_query(text)

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed many strings at once — one vector per input, same order."""
        return self._model.embed_documents(texts)


_provider: EmbeddingProvider | None = None


def get_embeddings() -> EmbeddingProvider:
    """Return the process-wide EmbeddingProvider, constructing it on first use."""
    global _provider
    # Lazily build the singleton so the model loads once and is shared thereafter.
    if _provider is None:
        _provider = EmbeddingProvider()
    return _provider
