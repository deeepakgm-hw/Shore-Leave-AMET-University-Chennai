import base64
import json
import sys

import cv2
import numpy as np


MIN_FACE_RATIO = 0.11
MAX_FACE_RATIO = 0.42
MAX_CENTER_OFFSET_X = 0.14
MAX_CENTER_OFFSET_Y = 0.18
MIN_SHARPNESS = 55.0
MAX_SCAN_DIMENSION = 960
FACE_CASCADE_FILES = (
    "haarcascade_frontalface_default.xml",
    "haarcascade_frontalface_alt.xml",
    "haarcascade_frontalface_alt2.xml",
)


def emit(payload):
    sys.stdout.write(json.dumps(payload))


def fail(message, checks=None):
    emit({
        "success": False,
        "message": message,
        "checks": checks or {}
    })
    sys.exit(0)


def decode_frame(frame_data_url):
    if not frame_data_url or "," not in frame_data_url:
      raise ValueError("Invalid image payload.")
    encoded = frame_data_url.split(",", 1)[1]
    image_bytes = base64.b64decode(encoded)
    np_buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode the uploaded image.")
    return image


def resize_for_detection(image):
    height, width = image.shape[:2]
    scale = 1.0
    largest = max(width, height)
    if largest > MAX_SCAN_DIMENSION:
        scale = MAX_SCAN_DIMENSION / float(largest)
        image = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    return image, scale


def measure_sharpness(gray_roi):
    return float(cv2.Laplacian(gray_roi, cv2.CV_64F).var())


def encode_face(face_image):
    ok, buffer = cv2.imencode(".jpg", face_image, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not ok:
        raise ValueError("Could not encode the cropped face image.")
    return "data:image/jpeg;base64," + base64.b64encode(buffer.tobytes()).decode("ascii")


def detect_faces(gray_scan):
    cascades = []
    for name in FACE_CASCADE_FILES:
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + name)
        if not cascade.empty():
            cascades.append(cascade)

    if not cascades:
        raise ValueError("OpenCV frontal-face cascades are not available on this machine.")

    min_face = max(80, int(min(gray_scan.shape[0], gray_scan.shape[1]) * 0.16))
    processed = cv2.equalizeHist(gray_scan)

    for index, cascade in enumerate(cascades):
        faces = cascade.detectMultiScale(
            processed,
            scaleFactor=1.1,
            minNeighbors=7 if index == 0 else 5,
            minSize=(min_face, min_face)
        )
        if len(faces) > 0:
            return faces

    for cascade in cascades:
        faces = cascade.detectMultiScale(
            processed,
            scaleFactor=1.05,
            minNeighbors=4,
            minSize=(max(64, int(min_face * 0.85)), max(64, int(min_face * 0.85)))
        )
        if len(faces) > 0:
            return faces

    return []


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        image = decode_frame(payload.get("frame"))
    except Exception as exc:
        fail(str(exc))

    scan_image, scale = resize_for_detection(image)
    gray_scan = cv2.cvtColor(scan_image, cv2.COLOR_BGR2GRAY)

    eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye_tree_eyeglasses.xml")

    faces = detect_faces(gray_scan)

    if len(faces) == 0:
        fail("No front-facing face was detected.")

    if len(faces) > 1:
        fail("Multiple faces detected. Keep only one cadet in frame.")

    x, y, w, h = [int(v / scale) for v in faces[0]]
    frame_h, frame_w = image.shape[:2]
    face_area_ratio = float((w * h) / float(frame_w * frame_h))
    center_x = (x + (w / 2.0)) / frame_w
    center_y = (y + (h / 2.0)) / frame_h
    centered = abs(center_x - 0.5) <= MAX_CENTER_OFFSET_X and abs(center_y - 0.48) <= MAX_CENTER_OFFSET_Y
    proper_distance = MIN_FACE_RATIO <= face_area_ratio <= MAX_FACE_RATIO

    gray_full = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    face_roi = gray_full[y:y + h, x:x + w]
    sharpness = measure_sharpness(face_roi) if face_roi.size else 0.0
    sharp_enough = sharpness >= MIN_SHARPNESS

    eye_region = gray_full[y:y + int(h * 0.62), x:x + w]
    eyes = eye_cascade.detectMultiScale(eye_region, scaleFactor=1.08, minNeighbors=5, minSize=(18, 18))
    frontal = len(eyes) >= 2

    checks = {
        "singleFace": True,
        "centered": centered,
        "properDistance": proper_distance,
        "sharpEnough": sharp_enough,
        "frontFacing": frontal,
        "eyeCount": int(len(eyes)),
        "sharpness": round(sharpness, 2),
        "areaRatio": round(face_area_ratio, 4)
    }

    if not frontal:
        fail("Face must be front-facing with both eyes visible.", checks)
    if not centered:
        fail("Center the cadet inside the guide circle.", checks)
    if not proper_distance:
        fail("Adjust distance so the face fits the guide properly.", checks)
    if not sharp_enough:
        fail("The frame is too blurry. Hold steady and try again.", checks)

    pad_x = int(w * 0.34)
    pad_top = int(h * 0.42)
    pad_bottom = int(h * 0.24)

    sx = max(0, x - pad_x)
    sy = max(0, y - pad_top)
    ex = min(frame_w, x + w + pad_x)
    ey = min(frame_h, y + h + pad_bottom)
    cropped_face = image[sy:ey, sx:ex]

    if cropped_face.size == 0:
        fail("Face crop failed. Please try again.", checks)

    emit({
        "success": True,
        "message": "Capture successful",
        "faceImage": encode_face(cropped_face),
        "box": {
            "x": x,
            "y": y,
            "width": w,
            "height": h
        },
        "checks": checks
    })


if __name__ == "__main__":
    main()
