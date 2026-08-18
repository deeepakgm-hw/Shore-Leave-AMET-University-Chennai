const path = require('path');
const { execFile } = require('child_process');

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'validate_face_frame.py');

function validateFaceFrame(frameDataUrl) {
  return new Promise((resolve, reject) => {
    if (!frameDataUrl || !String(frameDataUrl).startsWith('data:image/')) {
      reject(new Error('A valid face frame image is required.'));
      return;
    }

    const child = execFile(
      PYTHON_BIN,
      [SCRIPT_PATH],
      { maxBuffer: 12 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const reason = stderr && stderr.trim() ? stderr.trim() : error.message;
          reject(new Error(`OpenCV validation failed: ${reason}`));
          return;
        }

        try {
          const payload = JSON.parse((stdout || '').trim());
          resolve(payload);
        } catch (parseError) {
          const debug = stderr && stderr.trim() ? stderr.trim() : (stdout || '').trim();
          reject(new Error(`OpenCV validation returned invalid JSON. ${debug}`.trim()));
        }
      }
    );

    child.stdin.end(JSON.stringify({ frame: frameDataUrl }));
  });
}

module.exports = {
  validateFaceFrame
};
