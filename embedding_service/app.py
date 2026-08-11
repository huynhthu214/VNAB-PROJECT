from fastapi import FastAPI
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer("BAAI/bge-m3")

@app.post("/embed")
def embed(payload: dict):
    text = payload["text"]
    vector = model.encode(text).tolist()
    return {"embedding": vector}