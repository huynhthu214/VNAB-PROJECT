"""VNAB E3 — dev/smoke runner, Python 3 standard library only.
Copy to research/scripts/. Run from the repository root.
Never sends gold answers, context, type, or IDs to the QA API.
"""
import argparse
import csv
import hashlib
import json
import subprocess
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

MODELS = ("rule_based", "naive_rag", "modular_rag")
DATASET_SHA = "e1317a5d27d85426f1e22a0efdb695aacd335a77d79ae9ddd918dd86fa6651ee"
PROVINCES = {"TP. Hồ Chí Minh": "HCM", "Tỉnh An Giang": "AG", "Tỉnh Cà Mau": "CM", "Thành phố Cần Thơ": "CT", "Tỉnh Đồng Nai": "DN", "Tỉnh Đồng Tháp": "DT", "Tỉnh Tây Ninh": "TN", "Tỉnh Vĩnh Long": "VL", "Ngoài phạm vi": None}
SMOKE_TYPES = ("T1", "T2", "T7", "T8_ambiguous", "T8_out_of_scope")

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def dump(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def read_dev(path):
    if sha(path) != DATASET_SHA:
        raise ValueError("Dataset SHA-256 mismatch; use the frozen VNAB v1.0 ZIP.")
    with zipfile.ZipFile(path) as z:
        rows = [json.loads(line) for line in z.read("qa_dev.jsonl").decode("utf-8-sig").splitlines() if line.strip()]
    if len(rows) != 50 or len({r['id'] for r in rows}) != 50:
        raise ValueError("Expected 50 unique Full QA dev rows.")
    for r in rows:
        p = unicodedata.normalize("NFC", r["province"])
        if p not in PROVINCES or not 0 < len(r["question"].encode('utf-16-le'))//2 <= 500:
            raise ValueError(f"Invalid scope/question: {r['id']}")
    return rows

def request(url, payload=None):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    start = time.perf_counter()
    status = None
    try:
        with urllib.request.urlopen(req, timeout=120 if body else 10) as response:
            status = response.status
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        raw = e.read().decode("utf-8", errors="replace")
    except (OSError, urllib.error.URLError) as e:
        return status, {"transport_error": str(e)}, (time.perf_counter()-start)*1000
    try:
        obj = json.loads(raw)
        if not isinstance(obj, dict):
            obj = {"unexpected_response": obj}
    except ValueError:
        obj = {"non_json_response": raw}
    return status, obj, (time.perf_counter()-start)*1000

def git(root, *args):
    try:
        return subprocess.check_output(["git", "-C", str(root), *args], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mode", choices=("smoke", "dev"), default="smoke")
    p.add_argument("--dataset", type=Path, default=Path("research/handoff/v1.0/vnab-dataset-v1.0.zip"))
    p.add_argument("--provider", choices=("gemini", "cohere"), required=True)
    p.add_argument("--api", default="http://localhost:3000/api/v1")
    p.add_argument("--interval", type=float, default=8, help="Minimum seconds between successive API starts (all methods).")
    p.add_argument("--output", type=Path, default=Path("research/reports/E3"))
    args = p.parse_args()
    if args.interval < 0:
        p.error("interval must be nonnegative")
    root = Path.cwd()
    rows = read_dev(args.dataset)
    if args.mode == "smoke":
        rows = [next(r for r in rows if r['type'] == t) for t in SMOKE_TYPES]
    api = args.api.rstrip('/')
    status, health, _ = request(api + "/health")
    if status != 200 or health.get('success') is not True:
        raise SystemExit(f"Backend health FAIL: {status} {health}")
    print("HEALTH OK:", json.dumps(health, ensure_ascii=False), flush=True)
    run = args.output / (args.mode + '_' + datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f'))
    run.mkdir(parents=True, exist_ok=False)
    paths = ['backend/src/controllers/qa.controller.js', 'backend/src/services/llmProviders.js', 'backend/src/utils/lookupNormalize.js', 'backend/package.json', 'backend/package-lock.json', 'embedding_service/requirements.txt']
    manifest = {"mode": args.mode, "split": "dev", "dataset_sha256": DATASET_SHA, "provider": args.provider, "models": MODELS, "api": api, "interval_seconds": args.interval, "question_count": len(rows), "expected_rows": len(rows)*len(MODELS), "ids": [r['id'] for r in rows], "git_commit": git(root, 'rev-parse', 'HEAD'), "git_dirty": bool(s) if (s := git(root, 'status', '--porcelain')) is not None else None, "source_hashes": {x: sha(root/x) for x in paths if (root/x).is_file()}, "server_flags": "Record actual server startup settings separately; runner cannot verify them", "scope_policy": "Use supplied province_code; omit for Ngoài phạm vi", "timing": "Client wall time, sequential, no controlled warmup, no retry", "runner_sha256": sha(Path(__file__)), "health": health}
    dump(run / 'manifest.json', manifest)
    results = []
    next_start = 0.0
    with (run/'predictions.jsonl').open('x', encoding='utf-8') as out:
        for model in MODELS:
            for row in rows:
                time.sleep(max(0, next_start-time.monotonic()))
                next_start = time.monotonic()+args.interval
                code = PROVINCES[unicodedata.normalize('NFC', row['province'])]
                payload = {"question": row['question'], "model": model, "llm_provider": args.provider}
                if code is not None:
                    payload['province_code'] = code
                status, response, elapsed = request(api+'/qa/ask', payload)
                data = response.get('data')
                data = data if isinstance(data, dict) else {}
                ok = status == 200 and response.get('success') is True and data.get('answer_type') in ('structured_lookup','rag_generated','no_answer')
                rec = {"id": row['id'], "province_code": code, "model": model, "question": row['question'], "http_status": status, "success": ok, "answer": data.get('answer'), "answer_type": data.get('answer_type'), "suggestion": data.get('suggestion'), "sources": data.get('sources'), "qa_log_id": data.get('qa_log_id'), "input_tokens": data.get('input_tokens'), "output_tokens": data.get('output_tokens'), "confidence": data.get('confidence'), "latency_ms": round(elapsed, 3), "error": None if ok else response.get('error_code', response.get('transport_error', 'INVALID_RESPONSE')), "raw_response": response}
                results.append(rec)
                out.write(json.dumps(rec, ensure_ascii=False)+'\n'); out.flush()
                print(f"{len(results)}/{manifest['expected_rows']} {model} {code or 'NO_SCOPE'} {rec['answer_type'] if ok else rec['error']}", flush=True)
    fields = ['id','province_code','model','question','http_status','success','answer','answer_type','suggestion','sources','qa_log_id','input_tokens','output_tokens','confidence','latency_ms','error']
    with (run/'predictions.csv').open('x', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields); writer.writeheader()
        for r in results:
            writer.writerow({k: json.dumps(r[k], ensure_ascii=False) if isinstance(r[k], (dict,list)) else r[k] for k in fields})
    summary = []
    for model in MODELS:
        rs = [r for r in results if r['model']==model]
        summary.append({"model":model,"attempted":len(rs),"api_success":sum(r['success'] for r in rs),"api_errors":sum(not r['success'] for r in rs),"no_answer":sum(r['success'] and r['answer_type']=='no_answer' for r in rs)})
    dump(run/'summary.json', summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print('RESULTS:', run.resolve())
    print('No quality score computed. Review predictions with the separate dev gold file.')
    if any(not r['success'] for r in results):
        raise SystemExit('API errors present; investigate before a formal run.')

if __name__ == '__main__':
    main()
