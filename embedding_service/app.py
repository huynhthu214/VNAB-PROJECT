from fastapi import FastAPI
from sentence_transformers import SentenceTransformer, CrossEncoder   # ← THÊM CrossEncoder

app = FastAPI()
model = SentenceTransformer("BAAI/bge-m3")
reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")  

@app.post("/embed")
def embed(payload: dict):
    text = payload["text"]
    vector = model.encode(text).tolist()
    return {"embedding": vector}

# ============ CHÈN MỚI TẠI ĐÂY ============
@app.post("/rerank")
def rerank(payload: dict):
    query = payload["query"]
    documents = payload["documents"]

    if not documents:
        return {"scores": []}

    pairs = [[query, doc] for doc in documents]
    raw_scores = reranker.predict(pairs)  
    return {"scores": raw_scores.tolist()}