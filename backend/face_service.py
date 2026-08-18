from base64 import b64decode
from binascii import Error as Base64Error
from datetime import datetime, timezone
from pathlib import Path
import os

import cv2
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from insightface.app import FaceAnalysis
from pymongo import MongoClient
import numpy as np


app = Flask(__name__)
CORS(app)


def load_local_env():
    """Load simple KEY=value entries from backend/.env if they are not set."""
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()


print("Loading InsightFace model... please wait")
face_app = FaceAnalysis(
    name="buffalo_sc",
    providers=["CPUExecutionProvider"],
)
face_app.prepare(ctx_id=0, det_size=(320, 320))
print("InsightFace model loaded and ready")


MONGO_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGODB_URI (or legacy MONGO_URI) is required")
client = MongoClient(
    MONGO_URI,
    maxPoolSize=10,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=10000,
)
FACE_DATABASE_NAME = os.getenv("FACE_DATABASE_NAME", "shoreleave")
db = client[FACE_DATABASE_NAME]
embeddings_col = db["face_embeddings"]


def ensure_mongo_connected():
    client.admin.command("ping")
    return True


def ensure_indexes():
    ensure_mongo_connected()
    embeddings_col.create_index(
        "cadetId",
        unique=True,
        partialFilterExpression={"cadetId": {"$type": "string"}},
    )


try:
    ensure_indexes()
    print("MongoDB connected to shoreleave; unique face_embeddings.cadetId index ready")
except Exception:
    print("MongoDB startup check failed: connection or index initialization error")


def decode_image_with_metadata(base64_string):
    if not isinstance(base64_string, str) or not base64_string.strip():
        raise ValueError("imageBase64 must be a non-empty base64 string")

    had_data_url = "," in base64_string
    if "," in base64_string:
        base64_string = base64_string.split(",", 1)[1]

    try:
        img_bytes = b64decode(base64_string, validate=True)
    except (Base64Error, ValueError) as exc:
        raise ValueError("imageBase64 is not valid base64 data") from exc

    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("imageBase64 does not contain a readable image")

    original_height, original_width = img.shape[:2]
    resized = cv2.resize(img, (320, 320))
    return resized, {
        "bytes": len(img_bytes),
        "originalWidth": int(original_width),
        "originalHeight": int(original_height),
        "resizedWidth": 320,
        "resizedHeight": 320,
        "hadDataUrlPrefix": had_data_url,
    }


def decode_image(base64_string):
    img, _metadata = decode_image_with_metadata(base64_string)
    return img


def get_face_analysis(img):
    faces = face_app.get(img)
    if not faces:
        return {
            "embedding": None,
            "faceCount": 0,
            "detScore": None,
        }

    face = max(faces, key=lambda item: item.det_score)
    return {
        "embedding": face.embedding,
        "faceCount": len(faces),
        "detScore": float(face.det_score),
    }


def get_embedding(img):
    return get_face_analysis(img)["embedding"]


def verification_response(code, message, status=400, **extra):
    payload = {
        "matched": False,
        "code": code,
        "reason": code.lower(),
        "error": message,
        "message": message,
    }
    payload.update(extra)
    print(
        "[FaceVerify] "
        f"code={code} faceDetected={payload.get('faceDetected')} "
        f"faceCount={payload.get('faceCount')} embeddingGenerated={payload.get('embeddingGenerated')}"
    )
    return jsonify(payload), status


def request_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError("Request body must be valid JSON")
    return data


@app.route("/", methods=["GET"])
@app.route("/status", methods=["GET"])
def index():
    try:
        enrolled_count = embeddings_col.count_documents({}, maxTimeMS=1000)
        database_status = "connected"
    except Exception:
        enrolled_count = "unavailable"
        database_status = "unavailable"

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shore Leave Face Service</title>
  <style>
    body {{
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f4f7fb;
      color: #14213d;
    }}
    main {{
      max-width: 860px;
      margin: 48px auto;
      padding: 0 20px;
    }}
    .panel {{
      background: #ffffff;
      border: 1px solid #d8e1ec;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 10px 30px rgba(20, 33, 61, 0.08);
    }}
    h1 {{
      margin: 0 0 10px;
      font-size: 30px;
    }}
    .ok {{
      display: inline-block;
      margin: 10px 0 24px;
      padding: 7px 11px;
      border-radius: 999px;
      background: #dcfce7;
      color: #166534;
      font-weight: 700;
      font-size: 14px;
    }}
    dl {{
      display: grid;
      grid-template-columns: 170px 1fr;
      gap: 10px 18px;
      margin: 0 0 24px;
    }}
    dt {{
      font-weight: 700;
      color: #334155;
    }}
    dd {{
      margin: 0;
      color: #0f172a;
    }}
    code {{
      background: #eef2f7;
      border: 1px solid #dbe4ef;
      border-radius: 6px;
      padding: 3px 6px;
    }}
    ul {{
      margin: 10px 0 0;
      padding-left: 20px;
    }}
    li {{
      margin: 8px 0;
    }}
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>Shore Leave Face Service</h1>
      <div class="ok">Running</div>
      <dl>
        <dt>Model</dt>
        <dd>InsightFace buffalo_sc</dd>
        <dt>Database</dt>
        <dd>{database_status}</dd>
        <dt>Enrolled faces</dt>
        <dd>{enrolled_count}</dd>
        <dt>Service port</dt>
        <dd>{os.getenv("FACE_SERVICE_PORT", "5001")}</dd>
      </dl>
      <h2>Available endpoints</h2>
      <ul>
        <li><code>GET /health</code> returns JSON health status.</li>
        <li><code>POST /enroll</code> enrolls a cadet face with cadetId, cadetName, and imageBase64.</li>
        <li><code>POST /verify</code> verifies imageBase64 against enrolled faces.</li>
      </ul>
    </section>
  </main>
</body>
</html>"""
    return Response(html, mimetype="text/html")


@app.errorhandler(404)
def not_found(_error):
    if request.method == "GET":
        return index()
    return jsonify({"error": "Endpoint not found"}), 404


@app.route("/enroll", methods=["POST"])
def enroll():
    try:
        ensure_mongo_connected()
        data = request_body()
        cadet_id = data.get("cadetId")
        cadet_name = data.get("cadetName") or ""
        image_b64 = data.get("imageBase64")

        if not cadet_id or not image_b64:
            return jsonify({"error": "cadetId and imageBase64 are required"}), 400

        img = decode_image(image_b64)
        embedding = get_embedding(img)

        if embedding is None:
            return jsonify({"error": "No face detected. Please try again with better lighting"}), 400

        embeddings_col.update_one(
            {"cadetId": cadet_id},
            {
                "$set": {
                    "cadetId": cadet_id,
                    "cadetName": cadet_name,
                    "embedding": embedding.tolist(),
                    "enrolledAt": datetime.now(timezone.utc),
                    "enrolledBy": "face_service",
                }
            },
            upsert=True,
        )

        saved = embeddings_col.find_one({"cadetId": cadet_id})
        if not saved:
            raise RuntimeError("Save verification failed")

        return jsonify(
            {
                "success": True,
                "message": f"Face enrolled successfully for {cadet_name or cadet_id}",
                "enrolledAt": saved.get("enrolledAt"),
                "documentId": str(saved.get("_id")),
            }
        )

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/verify", methods=["POST"])
def verify():
    try:
        ensure_mongo_connected()
        data = request_body()
        image_b64 = data.get("imageBase64")

        if not image_b64:
            return jsonify({"error": "imageBase64 is required"}), 400

        img, image_metadata = decode_image_with_metadata(image_b64)
        face_result = get_face_analysis(img)
        embedding = face_result["embedding"]

        if embedding is None:
            return verification_response(
                "NO_FACE_DETECTED",
                "No face detected. Please look directly at the camera.",
                400,
                faceDetected=False,
                faceCount=0,
                embeddingGenerated=False,
                image=image_metadata,
            )

        if face_result["faceCount"] > 1:
            return verification_response(
                "MULTIPLE_FACES_DETECTED",
                "Multiple faces detected. Please keep only the cadet in frame.",
                400,
                faceDetected=True,
                faceCount=face_result["faceCount"],
                detectionScore=round(face_result["detScore"], 4) if face_result["detScore"] is not None else None,
                embeddingGenerated=True,
                image=image_metadata,
            )

        all_cadets = list(embeddings_col.find({}))
        if not all_cadets:
            return verification_response(
                "NO_ENROLLED_FACES",
                "No enrolled cadet faces are available for verification.",
                404,
                faceDetected=True,
                faceCount=face_result["faceCount"],
                detectionScore=round(face_result["detScore"], 4) if face_result["detScore"] is not None else None,
                embeddingGenerated=True,
                image=image_metadata,
            )

        best_match = None
        best_score = -1.0
        threshold = float(os.getenv("FACE_MATCH_THRESHOLD", "0.4"))

        for cadet in all_cadets:
            stored_embedding = np.array(cadet.get("embedding", []), dtype=np.float32)
            if stored_embedding.size == 0:
                continue

            denominator = np.linalg.norm(embedding) * np.linalg.norm(stored_embedding)
            if denominator == 0:
                continue

            score = float(np.dot(embedding, stored_embedding) / denominator)
            if score > best_score:
                best_score = score
                best_match = cadet

        diagnostics = {
            "faceDetected": True,
            "faceCount": face_result["faceCount"],
            "detectionScore": round(face_result["detScore"], 4) if face_result["detScore"] is not None else None,
            "embeddingGenerated": True,
            "similarity": round(best_score, 6) if best_score >= 0 else None,
            "threshold": threshold,
            "image": image_metadata,
            "candidateCount": len(all_cadets),
        }

        if best_match and best_score >= threshold:
            print(
                "[FaceVerify] matched=True "
                f"faceCount={face_result['faceCount']} embeddingGenerated=True"
            )
            return jsonify(
                {
                    "matched": True,
                    "cadetId": best_match.get("cadetId"),
                    "cadetName": best_match.get("cadetName"),
                    "confidence": round(best_score * 100, 2),
                    "similarity": round(best_score, 6),
                    "threshold": threshold,
                    "code": "FACE_MATCHED",
                    "reason": "face_matched",
                    "faceDetected": True,
                    "faceCount": face_result["faceCount"],
                    "embeddingGenerated": True,
                    "diagnostics": diagnostics,
                }
            )

        return verification_response(
            "SIMILARITY_BELOW_THRESHOLD",
            "Face similarity is below the required verification threshold.",
            200,
            **diagnostics,
        )

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "Face verification service error"}), 500


@app.route("/health", methods=["GET"])
def health():
    try:
        ensure_mongo_connected()
        database_status = "connected"
        enrolled_count = embeddings_col.count_documents({}, maxTimeMS=1000)
    except Exception:
        database_status = "unavailable"
        enrolled_count = None
    return jsonify({
        "status": "running",
        "model": "InsightFace buffalo_sc",
        "database": database_status,
        "databaseName": "shoreleave",
        "enrolledFaces": enrolled_count,
    })


if __name__ == "__main__":
    port = int(os.getenv("FACE_SERVICE_PORT", "5001"))
    host = os.getenv("FACE_SERVICE_HOST", "127.0.0.1")
    print(f"Face service running internally on http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
